# tools/testdata/

テスト専用素材。デプロイ対象外 (web/ には含めない)。headless 回帰テストからのみ参照する。

| ファイル | 用途 | 素性 / ライセンス |
|---|---|---|
| `boot.d88` | `tools/bench_frame.js` / `tools/diskimage_test.js` の FreeDOS ブートディスク | FreeDOS(98) (GPL、再配布可) |
| `VZ.COM` | `tools/vz_test.js` の VZ Editor 起動回帰 (PC-98 版 Ver1.60) | VZ Editor。BSD-3-Clause (`VZ.LICENSE.txt`)。原作 中村満 (c.mos)、公開 vcraftjp <https://github.com/vcraftjp/VZEditor>。再配布は著作権表示の保持が条件 (= 同梱の `VZ.LICENSE.txt`) |
| `vz/*.DEF`, `vz/README.DOC` | `tools/vz_cursor_test.js` の VZ カーソル/編集キー回帰 (INT DCh 経由)。VZ を実起動して README.DOC を開き ↑↓←→ で行:桁が動くか検証 | VZ Editor 配布物。BSD-3-Clause (`VZ.LICENSE.txt` が全体を被覆) |

VZ.COM は BSD-3 で再配布可能なため、ゲーム書庫 (再配布許可なし → `.gitignore` で除外) と違い
リポジトリにコミットしている。
