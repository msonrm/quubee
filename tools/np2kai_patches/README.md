# NP2kai サブモジュール改変パッチ

`core/np2kai` (NP2kai 本家、git submodule) に対する qb 固有の改変を patch 形式で保存している。

## なぜパッチなのか

- `core/np2kai` は submodule で、qb repo はコミット pointer しか追跡しない
- submodule 内のローカル変更は `git submodule update` で消える
- フォークしてもよいが、追跡コストが高い
- → パッチを qb repo にコミットしておき、build 前 (または初回 checkout 後) に適用する

## パッチ一覧

| ファイル | 目的 |
|---|---|
| `01_dos_loader_hooks.patch` | Phase 3 ミニマル DOS ローダ用のフック。`bios_initialize` 末尾で `qb_dos_install_trampolines()` 呼び出し + `biosfunc()` switch に 12 case 追加 (0xFEE00 ローダ起動 / 0xFEE10 INT 21h / 0xFEE20 INT 20h / 0xFEE50 INT 2Fh=XMS 検出・応答 / 0xFEE60 INT 67h=EMS 需要プローブ / 0xFEE70 XMS ドライバ entry / 0xFEE80 INT 29h=DOS 高速文字出力 / 0xFEE90 .bat 文インタプリタ「次コマンド?」 / 0xFEEA0 INT DCh=編集キー定義 BIOS / 0xFEEB0 INT 27h=旧式 TSR / 0xFEEC0 INT 18h=仮想 30行BIOS フロントエンド / 0xFEEE0 INT 33h=マウスドライバ需要プローブ)。加えて `bios_initialize` で E800:0DC0 に `"NEC N-88BASIC(86)"` を配置 (Turbo-C BGI 等の NEC 実機判定対策、life100 -egc 根治)。実際のハンドラ本体は `native/dos_*.c` 側 (このパッチはコア側の入口=トランポリン dispatch のみ) |
| `02_font_reset_fix.patch` | `pccore_reset()` の `ZeroMemory(mem + FONT_ADRS, 0x08000)` を抑止。リセット毎に fontrom 先頭 0x8000 (= JIS 点 0..7 の漢字ブロック) が消去され、Wasm には再生成する hook_fontrom バックエンドが無いため、点1..7 の漢字 (あ/い/う 等) が永久に欠けるのを防ぐ |
| `03_rtc_y2k_clamp.patch` | `calendar.c:date2bcd` で年 >=2000 を 1999 にクランプ。90 年代ゲームが PC-98 RTC (μPD4990A) から直読みする年が 2026→126 の 3 桁になり固定幅セーブを壊す Y2K バグを汎用シムで回避 (蟹味噌のテキスト残留の真因)。共有フラグ `g_qb_y2k_clamp` (bridge.c・既定 ON) を参照し、実行時に `qbDebug.y2k(0)` で一括オフ可 (native の qb_timemng=RTC 種・dos_int21=DOS AH=2Ah も同フラグ)。回帰 `tools/y2k_test.js` |
| `06_beep_gain.patch` | `sound/beepg.c` に BEEP 専用ゲイン `g_qb_beep_gain` (%, bridge.c 定義・既定 100) を追加し、volM (`vol_master`) に畳む。BEEP は beepcfg.vol 0..3 の 4 段階で peak 2048 (-24dBFS) 頭打ちのため FM/MIDI 下で SE が埋もれる (amel133 報告)。旧方式 (vol_master 255 + vol_pcm=25 相殺) は相殺だけが fmgen ADPCM (ちびおと) に素で効き ADPCM -10dB の副作用 (2026-07-05 実測・精査 #15)。レンダラ内ゲインなら他音源へ波及ゼロ。回帰 `tools/beep_gain_test.js` + `tools/adpcm_beepgain_test.js` |
| `07_cpu_mem_fastpath.patch` | **CPU 高速化の統合パッチ**。初版 2026-07-10/11 (第 1 弾 = メモリ/フェッチ、第 2 弾 = 16bit 実モード)、**2026-09-27 に NP2kai 5939e0c6 へ移し直し**。本家はこの版で `memp_*_fast` (MMIO 登録表で直アクセス可否を判定する out-of-line 関数) を新設したが、07 なしでは Suika3 10.2ms / Ray 16.8ms と旧版より大幅に遅い。移し直し後は旧版比 Suika3 **約 5% 速い** (7.7→7.3ms)・Ray **同等** (9.3ms)、画面ハッシュ一致、全回帰 PASS。内容: ① `ia32/cpu.h` の `qb_phys_{read,write}{8,16,32}(_codefetch)` — conventional (<0xA4000/0xA0000) と拡張メモリの固定 2 窓 ([USE_HIMEM,EXTLIMIT16) / **[16MB,EXTLIMIT)** — DOS/4GW は 32bit コードをここに置く) を inline で直アクセスし、窓の外は本家 `memp_*_fast` が判定後に呼ぶのと同じ `*_slow` へ直接落とす (`cpumem.c` の `*_slow` の static を外して公開)。本家の既定の MMIO 登録は窓のちょうど外側 = 意味論は本家の高速版と同一。登録表を inline で引く版も A/B したが固定窓の方が Suika3 3%・Ray 1% 速く wasm も 130KB 小さかった。**安全装置**: 窓の上限は幅別に引き算済みのグローバル `qb_fastwin_lim{1,2}[k]` (`memp_mmio_map_reset` で張る)。窓と重なる MMIO が `memp_mmio_range_add` に来たら窓を空にして全部 `*_slow` へ回し、stderr に警告 (次のリセットで張り直し)。② `qb_codefetch{,_w,_d}` (inline 版 cpu_codefetch) + `ia32.mcr` GET_PC* / `interface.h` の高速版分岐を qb_phys_* へ。③ `qb_vmemoryread/write/RMW_{b,w,d}` — !PM 分岐 (cpu_mem.mcr と逐語同一) をインライン化、cpu_mem.c は `QB_CPU_MEM_IMPL` ガードで除外。④ `qb_load_segreg` — 実モード/VM86 の segdesc_set_default を逐語インライン (Ray の LES 連発が主客)。⑤ `cpu.c` exec_allstep に 16bit 頻出 10 命令の直接ディスパッチ。⑥ `cpumem.c` の `memp_read8_slow` / `memp_read8_codefetch_slow` に溢れアドレスの MB 帯ヒストグラム (`np2kai_debug_memprobe(100+i/200+i)`、速度 triage 用)。②〜⑤のコピー元 (cpu_codefetch / cpu_mem.mcr / segments.c) は 5939e0c6 でも不変であることを確認済み。wasm 1.38MB (07 なし 1.01MB)。関連: CMakeLists の `USE_CPU_INLINEINST`/`USE_CPU_EIPMASK`。計測は `tools/bench_game.js` (Suika3) + `tools/bench_ray.js` (Ray、画面ハッシュ出力あり) の両方で。**bench_frame.js は例外連発で longjmp を測ってしまい CPU 最適化 A/B に不適** |
| `08_adpcm_ram_fixes.patch` | **本家 NP21/W rev.103/104 取り込み (a14bb65) の ADPCM 退行 2 件の修正** (2026-09-27)。症状: ちびおと (86+ADPCM) の ADPCM が無音 — FMP が ADPCM RAM の書き込み→読み戻し検査で「ADPCM 無し」と判定し音色を送らない。① `sound/adpcmg.c:adpcm_readsample` のメモリ読み出し判定が `(ctrl1 & 0x60) == 0x20` から `!(ctrl2 & 2)` (RAM 種別ビット) に書き換わっており、x1-bit 設定 (ctrl2=0x02、FMP) で読み戻しが常に 0 → 旧条件に戻す。② `sound/adpcm.h` で新設の CPU FIFO (`cfifo`) が共用体で ADPCM RAM `buf[0x20000..]` (x1-bit のビット 4 プレーン / x8 の後半) と重なり、control1 のリセット (`0x01`) 毎の `adpcm_cpufifo_reset` が RAM を破壊 → FIFO を独立メンバに。FMP の ADPCM 操作列が旧版と完全一致することをプローブで確認。回帰 `tools/adpcm_beepgain_test.js` / `fmp_test.js`。別件で `adpcm_setreg` の CPU FIFO へのデータ投入が case 0x09/0x0a (delta) に入っている (0x08 のはず) が、CPU 直流しモードは QuuBee の扱うドライバが使わないので未修正。3 件とも本家への報告候補 |
| `09_statsave_hrtimer.patch` | **ステートセーブ (フェーズ 2) 用** (2026-09-27)。高精度タイマのイベント `NEVENT_HRTIMER` (34、`io/upd4990.c` の `upd4990_hrtimer_proc`) が `statsave.tbl` の `evtnum`/`evtproc` に無く、保存時に ID 0 で書かれてロード時に EVENT 区画が WARNING (0x80) になり、このイベントだけが消えていた (HRTIMER はポート 0x128 の bind で常に動き出すので全タイトルが該当。ロード後に IRQ15 と BDA 0x04F1 の刻みが止まる)。両表に登録 (`SUPPORT_HRTIMER` ガード)・`io/upd4990.h` に処理関数を宣言・関数内 static だった分周カウンタ 2 つを `_UPD4990HRT` へ移して statsave (uPD4990HRT は BIN 区画) に入れ、ロード後も位相をそろえる。加えて `uPD4990_bind()` が分周比とイベントを周期の頭から張り直していた (statsave のロードは EVENT 区画を戻した後で bind を呼ぶ) ので、イベントが既に動いていれば張り直さない (ロード後の CPU の区切りが変わり FM の書き込み位置がずれていた)。本家 5939e0c6 でも未修正 = 本家への報告候補。回帰 `tools/statesave_test.js` (ロードの戻り値 0) |
| `10_sound_pending.patch` | **ステートセーブ (フェーズ 2) 用** (2026-09-27)。`sound/sound.c` に `sound_pending_get` / `sound_pending_set` を追加 (`sound.h` に宣言)。sndstream の「合成済みで未再生」のサンプル (buffer..ptr) を取り出す / 差し戻す。statsave のロードは `sound_reset` でこれを捨て `soundcfg.lastclock` を現在のクロックに付け替えるため、ロード後の先頭 ~16000 サンプル (約 0.37 秒) が保存しなかった場合と食い違っていた (セーブの瞬間に鳴りかけていた音と、合成が CPU を追いかけていた遅れの分が欠ける)。QuuBee 区画 SND_ (`native/qb_soundmng.c`) がこれと lastclock/writecount を保存し、ロード後に差し戻す = 音声が全区間 1 サンプルも違わず続く。回帰 `tools/statesave_test.js` |
| `11_statsave_sound_restore.patch` | **ステートセーブで音源の状態を正しく戻す** (2026-09-27、東方 4 作の一致テストで判明した本家の不具合 3 件)。① fmgen の SSG のエンベロープの形 (ポインタ) が DataLoad で戻らない → レジスタ 0x0D から作り直す / ② statsave のロード後の bind が控えのレジスタを fmgen へ書き直し、キーオン (0x28) で鳴っている音のエンベロープがやり直し・SSG のカウンタが戻る → 読み込み直後だけ書き直さない (`opna->qb_fmgen_loaded`) / ③ 86 ボード + CS4231 (0x64 等) で拡張ポートの有効状態を CS4231 の旗で上書きし、ロード後にドライバの動きがずれる → CS4231 だけのボードのときだけ。回帰 `tools/statesave_touhou_test.js` |
| `12_port5f_realtime_wait.patch` | **ポート 5Fh のウェイトを実時間に** (2026-09-27)。`io/artic.c` の 5Fh 書き込みが固定 20 クロックで、倍率を上げるほど実時間で短くなっていた。実機は約 0.6us のウェイトに I/O サイクルが加わり倍率によらず一定なので、実時間 約 1.3us 分 (`pccore.realclock / 770000`) のクロックに。実害: 東方封魔録の MMD 2.2f が MPU の INT 自動判定で Clock to Host (5ms 周期) の割り込みを 5Fh x 4000 回だけ待ち、倍率 22 前後から INT2 の判定に失敗 → Mate-X 構成で MIDI が鳴らなかった (ちびおと構成は INT5 = IRQ 12 = 86 ボードの FM タイマに偶然便乗)。値は実機の実測ではなく MMD の要求 (1.25us 以上) を満たす妥当な値。修正後は倍率 20〜38 で MMD が本来の INT2 で常駐。副作用: 5Fh で待つソフトのタイミングが実機寄りに変わる (Suika3 のベンチの 600 フレーム目の画面が変わった。速度差はばらつきの範囲)。回帰 `tools/th02_midi_test.js` |

対象の本家版: **AZO234/NP2kai `wx_alpha` 5939e0c6 (2026-09-05)**。サブモジュールを上げたら全パッチ (01〜03・06〜12) が当たるか (`build.sh` は当たらないと hard fail) と全回帰・両ベンチを確認する。

### 保留中のパッチ (`pending/`)

`build.sh` は `tools/np2kai_patches/*.patch` (直下) だけを適用し、互換識別子 (ステートセーブ) のハッシュにも直下だけを入れる。
`pending/` に置いたものは適用もハッシュ計算もされない。**有効にすると互換識別子が変わり、利用者の既存ステートセーブが読めなくなる**ため、
告知の期間を置いてからまとめて入れるための置き場。

| ファイル | 目的 |
|---|---|
| `pending/13_fmgen_ssgeg_phase.patch` | **fmgen の SSG-EG 位相 assert で wasm が Abort する本家の不具合** (2026-10-04、New Horizons 体験版 Deadline 2026 で判明)。`Operator::KeyOn` が SSG-EG 無効でも `ssg_phase_ = -1` を残し、キーオン後に SSG-EG (type=8) を有効化すると `Prepare` の `assert(0 <= ssg_phase_)` が落ちる (-O2 でも assert 有効のため wasm 全体が停止。本家は -DNDEBUG で気づかれにくい)。SSG-EG 無効時は 0 を入れる。有効時の挙動は不変。ブラウザ実機で最後まで動作確認済み。**2026-10-10 に有効化予定** (起動時の告知ダイアログを先に出す。bridge.js の `STATE_NOTICE_UNTIL`) |

有効化の手順 (2026-10-10):

```bash
git mv tools/np2kai_patches/pending/13_fmgen_ssgeg_phase.patch tools/np2kai_patches/
# 上の表の行を「パッチ一覧」へ移し、対象の本家版の行の番号範囲 (01〜03・06〜12) に 13 を足す
bash emscripten/build.sh && node tools/run_tests.js   # build.sh が submodule へ自動適用する
```

> 注: 保留中は `core/np2kai` の作業ツリーにも **適用しない** こと。適用済みのまま build すると、互換識別子は旧値のままソースだけ変わった
> バイナリになる (2026-10-06 に動作確認用の適用を `git apply --reverse` で外した)。

### 削除したパッチ (2026-09-27、NP2kai 5939e0c6 追従時)

本家で解決済みになったため削除。番号は欠番のまま (再利用しない)。

- `04_lio_gscreen_disp_page.patch` — 本家が `lio/gscreen.c` を書き直し、問題の `mode |= disp << 4` が消えた。MIMPI + KNGNACHT.mid のミキサー画面が 04 なしで全表示されることを headless で確認。
- `05_lio_gcircle_arc.patch` — **本家が QuuBee の実装を取り込んだ** (NP21/W rev.103/104 merge、`LICENSES/LICENSE-LIO.TXT` = 「円・楕円・円弧・楕円弧の輪郭計算部分、参照元 QuuBee、MIT © msonrm」)。`tools/lio_gcircle_test.js` PASS。

削除前の内容 (記録):

- `04_lio_gscreen_disp_page.patch` (旧) — `lio/gscreen.c:lio_gscreen` の表示ページバグ修正。GSCREEN の disp パラメータ省略 (0xFF) 時にローカル変数 0xFF がそのまま `mode |= disp << 4` に流れ、bit4=1 で表示ページが勝手に 1 へ切り替わる (page0 に描いた絵が表示されず真っ黒)。`lio->work.disp` (正規化済み保持値) を使うよう修正。LIO (N88-BASIC グラフィック BIOS、INT A0h〜) で描画する MIMPI 等の背景消失の真因
- `05_lio_gcircle_arc.patch` (旧) — `lio/gcircle.c` の GCIRCLE に円弧 (扇形、e→s CCW・パイ線 flag bit2/3) と楕円 (rx≠ry) 描画を実装 (上流は真円のみ・`not support` マーカ)。真円は既存整数中点法パスのまま byte 同一 = ゼロ回帰。実 LIO テストプログラム 2 本のパラメータ実測 + np21w 出力照合によるクリーンルーム実装。回帰 `tools/lio_gcircle_test.js` (10 PASS)。NP2kai 上流への PR 候補

> 注: かつての `04_vermouth_gs_effects.patch` (VERMOUTH に GS リバーブ等を追加) は **revert 済み**
> (現在の 04 は別内容の LIO 修正)。MIDI 合成は VERMOUTH から TinySoundFont (`native/qb_tsf.c` +
> `native/third_party/tsf.h`、SF2 再生) に差し替えたため、VERMOUTH (`sound/vermouth/*.c`) は
> ビルドから外されている。

## 適用方法

```bash
# 初回 (submodule init 直後 or 上記パッチが当たっていない時)
cd core/np2kai
git apply ../../tools/np2kai_patches/*.patch
cd ../..
```

または build スクリプトで自動化したい場合は `emscripten/build.sh` の冒頭に:

```bash
# bios.c が未パッチなら適用
if ! grep -q "qb_dos_install_trampolines" core/np2kai/bios/bios.c; then
    (cd core/np2kai && git apply ../../tools/np2kai_patches/*.patch)
fi
```

## パッチを更新したい時

`core/np2kai/bios/bios.c` を手で編集 → 動作確認 → 以下で再生成:

```bash
git -C core/np2kai diff bios/bios.c > tools/np2kai_patches/01_dos_loader_hooks.patch
```
