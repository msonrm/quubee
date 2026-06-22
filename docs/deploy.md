# QuuBee デプロイ手順 (runbook)

公開サイトへ反映する一連の流れ。毎回ここを見れば迷わないことを目的にした正典。

## TL;DR — build → commit → push → deploy

コードを変更してブラウザ実機で確認できたら、この順で実行する。

```bash
# 1. ビルド (C/native を変えたとき。JS/asset だけなら不要)
bash emscripten/build.sh                    # → web/np2kai_core.{js,wasm}

# 2. コミット (自分の変更ファイルのみ明示 add。除外対象は下記)
git add <変更ファイル...>
git commit -F - <<'EOF'
<type>(<scope>): <日本語の要約>

<本文>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF

# 3. push (GitHub・要ネットワーク)
git push origin main

# 4. dist 生成 (web/ 複製 + soundfont 分割。ネット不要)
bash tools/deploy.sh

# 5. Cloudflare Pages へアップロード (要ネットワーク)
npx wrangler pages deploy dist --project-name quubee --branch main \
    --commit-dirty=true --commit-message "ASCII only message"
```

deploy は git とは独立 (wrangler の直アップロード)。**git push しても Pages は自動デプロイされない** ので
手順 4-5 は必須。逆に**ドキュメントだけの変更なら deploy 不要** (理由は下記「デプロイの実体」)。

## remotes

- `origin` = https://github.com/msonrm/quubee.git — 公開・クリーン。**push 先はここ**。
- `archive` = https://github.com/msonrm/qb-archive.git — アーカイブ用。
- 旧 private `msonrm/qb` は温存 (別物)。

## デプロイの実体

- Cloudflare Pages、プロジェクト名 **`quubee`**、本番 = **https://quubee.pages.dev**。
- **git 連携ではない**。`git push` では本番は変わらず、`wrangler pages deploy` が `dist/` を直接アップロードして反映する。
- `tools/deploy.sh` は `cp -rL web/. dist/` で **`web/` だけ** を `dist/` に複製する。`docs/`・`CLAUDE.md`・
  `CHANGELOG.md`・`tools/` は dist に入らない → **ドキュメント/メモリだけの変更は deploy しても本番バンドルに
  影響しない** (commit + push だけで足りる。無駄なアップロードを避ける)。

## 認証 (wrangler)

- 初回のみ `npx wrangler login` (ブラウザ認証・対話)。アカウントは `.wrangler/cache/wrangler-account.json` に
  キャッシュされ、以後は非対話で deploy できる。
- **ネットワークとサンドボックス**: Claude Code の Bash は既定サンドボックスでネットワークが遮断され、
  `wrangler whoami` / `git push` / `wrangler pages deploy` が "fetch failed / connectivity error" になる。
  → **ネットを使うコマンド (push・deploy) はサンドボックス解除で実行する** (Claude harness では
  `dangerouslyDisableSandbox: true`)。2026-06-22 にこれで Claude 環境から push も wrangler deploy も成功を確認した。
  - ※ 旧メモの「wrangler upload は Claude 環境からは不可、ユーザーが自端末で実行」は**誤り**だった
    (connectivity error の正体はサンドボックスのネット遮断であって、解除すれば通る)。

## soundfont (MIDI) — deploy 前に必ず確認

- `web/assets/soundfont.sf2` (GeneralUser GS、約 32MB) は **`.gitignore`**。無ければ
  `bash tools/setup_soundfont.sh` で取得してから deploy する。
- ⚠ **これが無いまま deploy すると本番から MIDI 音源が消える** (MIDI ゲームの回帰)。`ls web/assets/soundfont.sf2`
  で存在確認してから手順 4 へ。
- `deploy.sh` が Pages の「1 ファイル 25MiB 上限」対策として 16MiB ごとに `soundfont.sf2.00`/`.01`… へ分割し、
  `soundfont.json` マニフェスト (パート数を確定) を書く。ブラウザ側は遅延 on-demand で連結取得するため、
  非 MIDI ユーザーはダウンロードしない。
- 同様にリズム音源 (`web/assets/rhythm/2608_*.wav`) と `web/assets/font.bmp` も `web/` 配下にあること。

## commit / push の注意

- git のコミットメッセージは日本語可。末尾に co-author 行を付ける (この repo の慣例)。
- **wrangler の `--commit-message` は ASCII 必須** — 日本語を渡すと Cloudflare API が `8000111` で弾く。
- **commit してはいけないもの**:
  - `core/np2kai` — `build.sh` の patch 適用で submodule の working tree が常時 dirty (` m`)。記録 commit は
    不変なので、自分の変更ファイルだけを明示 `git add` し、submodule ポインタは触らない。
  - `dist/` — `.gitignore` のビルド成果物。
  - `web/assets/soundfont.sf2` — `.gitignore` (約 32MB)。
  - ゲームデータ・テスト書庫 — `games/*` は `.gitignore`。再配布不可なので**絶対にコミットしない**
    (リポジトリ直下に作ったテスト zip 等は deploy 前に削除する)。

## ローカル確認 (deploy 前)

- `node tools/devserver.js 8080` → http://localhost:8080/ (COOP/COEP 付き。**worker モード / SharedArrayBuffer に
  必須**なので `emrun` では不可)。本番は `web/_headers` が同ヘッダを出す。
- DevTools コンソールで `crossOriginIsolated === true` を確認。

## デプロイ後の検証

- `curl -I https://quubee.pages.dev/` が `200`。
- 変更が反映されたか本番アセットを直接 grep する。例:
  `curl -s https://quubee.pages.dev/player/bridge.js | grep "<今回入れた目印の文字列>"`。
- wrangler は本番 URL に加えてこのデプロイ固有のプレビュー URL (`https://<hash>.quubee.pages.dev`) も出す。
