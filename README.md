# Discord MP4 動画圧縮 Web版

Webページとして公開するためのサーバー版です。

ブラウザだけでMP4/H.264へ安定変換するのは難しいため、この版はサーバー側でFFmpegを実行します。ユーザーはWebページから動画をアップロードし、圧縮済みMP4をダウンロードします。

## ローカル実行

Node.js 20以上とFFmpegが必要です。

```bash
npm install
npm start
```

開くURL:

```text
http://localhost:3000
```

## Dockerで実行

Docker版はコンテナ内にFFmpegを入れます。

```bash
docker build -t discord-mp4-compressor-web .
docker run --rm -p 3000:3000 discord-mp4-compressor-web
```

## GitHubにアップしてWeb公開する

GitHub PagesではNode.jsやFFmpegを実行できないため、このアプリはGitHub Pages単体では動きません。GitHubにはソースコードを置き、RenderなどのホスティングサービスでWebアプリとして公開します。

### 1. GitHubへアップロード

GitHubで新しいリポジトリを作成し、このフォルダの中身をアップロードしてください。

アップロードする主なファイル:

- `server.js`
- `package.json`
- `Dockerfile`
- `render.yaml`
- `public/index.html`
- `.dockerignore`
- `.gitignore`
- `README.md`

### 2. Renderで公開

1. Renderで `New` -> `Blueprint` を選びます。
2. GitHubリポジトリを接続します。
3. `render.yaml` が検出されたら、そのまま作成します。
4. デプロイ完了後に表示されるURLを開きます。

`Dockerfile` の中でFFmpegをインストールするため、Render側で別途FFmpegを設定する必要はありません。

### 3. 身内向けにパスワードを付ける

RenderのEnvironment Variablesで次を設定すると、Basic認証が有効になります。

- `BASIC_AUTH_USER`
- `BASIC_AUTH_PASSWORD`

空のままだと認証なしで公開されます。

## 公開するときの注意

- 動画はサーバーへアップロードされます。
- 身内向けならBasic認証、ログイン、IP制限などを前段に置くのがおすすめです。
- `MAX_UPLOAD_MB` でアップロード上限を設定できます。
- 大きな動画を扱う場合は、サーバーのCPU、メモリ、ディスク容量に注意してください。
- HTTPSの前段にリバースプロキシやホスティングサービスを置いてください。

## 環境変数

- `PORT`: 起動ポート。既定値は `3000`
- `MAX_UPLOAD_MB`: アップロード最大サイズMB。既定値は `250`

## ライセンス注意

このWebアプリはFFmpegを実行します。公開、配布、改変時はFFmpeg側のライセンス条件も確認してください。
