import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import express from "express";
import multer from "multer";

const app = express();
const port = Number(process.env.PORT || 3000);
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 250);
const basicAuthUser = process.env.BASIC_AUTH_USER || "";
const basicAuthPassword = process.env.BASIC_AUTH_PASSWORD || "";
const tempRoot = path.join(os.tmpdir(), "discord-mp4-compressor");
const upload = multer({
  dest: tempRoot,
  limits: {
    fileSize: maxUploadMb * 1024 * 1024,
    files: 1
  }
});

await fsp.mkdir(tempRoot, { recursive: true });

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use((req, res, next) => {
  if (!basicAuthUser || !basicAuthPassword) return next();

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Discord MP4 Compressor"');
    return res.status(401).send("Authentication required");
  }

  const [user, password] = Buffer.from(encoded, "base64").toString("utf8").split(":");
  const ok = safeEqual(user, basicAuthUser) && safeEqual(password, basicAuthPassword);

  if (!ok) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Discord MP4 Compressor"');
    return res.status(401).send("Authentication required");
  }

  next();
});
app.use(express.static(path.join(process.cwd(), "public"), {
  extensions: ["html"],
  maxAge: 0
}));

function safeName(name) {
  const ext = path.extname(name || "").toLowerCase() || ".mp4";
  const base = path.basename(name || "video", ext)
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "video";
  return `${base}-discord-5mb.mp4`;
}

function safeEqual(a, b) {
  const left = Buffer.from(a || "");
  const right = Buffer.from(b || "");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} failed with exit code ${code}\n${stderr}`));
      }
    });
  });
}

async function durationSeconds(filePath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("動画の長さを取得できませんでした。");
  }
  return Math.max(1, duration);
}

async function cleanup(...pathsToDelete) {
  await Promise.all(pathsToDelete.map(item =>
    item ? fsp.rm(item, { force: true, recursive: true }).catch(() => {}) : Promise.resolve()
  ));
}

app.get("/api/health", async (req, res) => {
  try {
    await run("ffmpeg", ["-version"]);
    await run("ffprobe", ["-version"]);
    res.json({ ok: true, ffmpegReady: true, maxUploadMb });
  } catch {
    res.json({ ok: true, ffmpegReady: false, maxUploadMb });
  }
});

app.post("/api/compress", upload.single("video"), async (req, res) => {
  const inputPath = req.file?.path;
  const jobId = crypto.randomUUID();
  const outputPath = path.join(tempRoot, `${jobId}.mp4`);

  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "動画ファイルを選択してください。" });
    }
    if (!req.file.mimetype.startsWith("video/")) {
      await cleanup(inputPath);
      return res.status(400).json({ ok: false, error: "動画ファイルだけアップロードできます。" });
    }

    const targetMb = Math.min(25, Math.max(1, Number(req.body.targetMb || 5)));
    const maxWidth = Math.min(1920, Math.max(240, Number(req.body.maxWidth || 960)));
    const fps = Math.min(60, Math.max(8, Number(req.body.fps || 30)));
    const targetBytes = targetMb * 1024 * 1024;
    const duration = await durationSeconds(inputPath);
    const audioKbps = 64;
    const safety = 0.9;
    const videoKbps = Math.max(120, Math.floor(((targetBytes * 8 * safety) / 1000 / duration) - audioKbps));

    await run("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vf", `scale='min(${maxWidth},iw)':-2,fps=${fps}`,
      "-c:v", "libx264",
      "-preset", "medium",
      "-b:v", `${videoKbps}k`,
      "-maxrate", `${videoKbps}k`,
      "-bufsize", `${Math.max(videoKbps * 2, 240)}k`,
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-b:a", `${audioKbps}k`,
      "-ac", "2",
      outputPath
    ]);

    const stat = await fsp.stat(outputPath);
    const downloadName = safeName(req.file.originalname);

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    res.setHeader("X-Compressed-Size", String(stat.size));
    res.setHeader("X-Under-Target", String(stat.size <= targetBytes));

    const stream = fs.createReadStream(outputPath);
    stream.on("close", () => cleanup(inputPath, outputPath));
    stream.pipe(res);
  } catch (error) {
    await cleanup(inputPath, outputPath);
    res.status(500).json({
      ok: false,
      error: error.message || "圧縮に失敗しました。"
    });
  }
});

app.use((error, req, res, next) => {
  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      ok: false,
      error: `アップロードできる動画は最大${maxUploadMb}MBです。`
    });
  }
  res.status(500).json({ ok: false, error: error.message || "サーバーエラーが発生しました。" });
});

app.listen(port, () => {
  console.log(`Discord MP4 Compressor Web is running on port ${port}`);
});
