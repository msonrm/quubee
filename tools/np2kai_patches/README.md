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
| `09_statsave_hrtimer.patch` | **ステートセーブ (フェーズ 2) 用** (2026-09-27)。高精度タイマのイベント `NEVENT_HRTIMER` (34、`io/upd4990.c` の `upd4990_hrtimer_proc`) が `statsave.tbl` の `evtnum`/`evtproc` に無く、保存時に ID 0 で書かれてロード時に EVENT 区画が WARNING (0x80) になり、このイベントだけが消えていた (HRTIMER はポート 0x128 の bind で常に動き出すので全タイトルが該当。ロード後に IRQ15 と BDA 0x04F1 の刻みが止まる)。両表に登録 (`SUPPORT_HRTIMER` ガード)・`io/upd4990.h` に処理関数を宣言・関数内 static だった分周カウンタ 2 つを `_UPD4990HRT` へ移して statsave (uPD4990HRT は BIN 区画) に入れ、ロード後も位相をそろえる。本家 5939e0c6 でも未修正 = 本家への報告候補。回帰 `tools/statesave_test.js` (ロードの戻り値 0) |

対象の本家版: **AZO234/NP2kai `wx_alpha` 5939e0c6 (2026-09-05)**。サブモジュールを上げたら全パッチが当たるか (`build.sh` は当たらないと hard fail) と全回帰・両ベンチを確認する。

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
