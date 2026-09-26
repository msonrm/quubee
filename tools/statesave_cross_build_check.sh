#!/bin/bash
# statesave_cross_build_check.sh — ステートセーブがビルドをまたいで読めることの確認 (フェーズ 2 段階 E)。
#
# QuuBee 側に無害な変更 (エクスポートされる関数を 1 つ足す = コードの配置が変わる・版の表示を変える) を
# 入れた別ビルドを作り、今のビルド (web/np2kai_core.*) との間で互いにセーブを読めて、続きが一致する
# ことを確かめる。NP2kai 側は同じなので互換識別子は一致するはず (違えば「以前の版」として断る)。
# 既存の Wasm 線形メモリ丸ごとの snapshot (tools/lib/machine.js) はビルド SHA に縛られるが、
# 保存ファイル (web/player/statefmt.js) はそれに縛られないことの証明。
#
# ビルドに数分かかるので回帰 (run_tests.js) には入れない。NP2kai を上げた時や保存形式を変えた時に回す。
# 前提: 先に bash emscripten/build.sh 済み (web/np2kai_core.* と native/qb_build_id.h がある)。
# 使い方: bash tools/statesave_cross_build_check.sh [作業ディレクトリ]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${1:-$(mktemp -d /tmp/statesave_cross.XXXXXX)}"
echo "work: $WORK"
rm -rf "$WORK/native" "$WORK/web" "$WORK/tools"
cp -r "$ROOT/native" "$WORK/native"
sed -i "s#^set(NP2 .*#set(NP2 $ROOT/core/np2kai)#" "$WORK/native/CMakeLists.txt"
sed -i 's/#define QB_BUILD_REV ".*"/#define QB_BUILD_REV "cross-build-check"/' "$WORK/native/qb_build_id.h"
cat >> "$WORK/native/dos_int21.c" <<'EOF'

/* statesave_cross_build_check: 無害な追加 (エクスポートして残す = コードの配置を変える) */
int qb_cross_build_marker(void) { fprintf(stderr, "[cross] marker\n"); return 42; }
EOF
sed -i 's/^    _np2kai_state_np2_save$/    _np2kai_state_np2_save\n    _qb_cross_build_marker/' "$WORK/native/CMakeLists.txt"
grep -q '_qb_cross_build_marker' "$WORK/native/CMakeLists.txt"

if [ ! -f "$WORK/build/Makefile" ]; then emcmake cmake -S "$WORK/native" -B "$WORK/build" > "$WORK/cmake.log"; fi
emmake make -C "$WORK/build" -j"$(nproc)" > "$WORK/make.log"

mkdir -p "$WORK/tools"
cp -r "$ROOT/tools/lib" "$WORK/tools/lib"
cp -r "$ROOT/web" "$WORK/web"
cp "$WORK/build/np2kai_core.js" "$WORK/build/np2kai_core.wasm" "$WORK/web/"

node - "$ROOT" "$WORK" <<'EOF'
const [root, work] = process.argv.slice(2);
const fs = require('fs'), os = require('os'), path = require('path');
const Here = require(path.join(root, 'tools/lib/machine')).Machine;
const There = require(path.join(work, 'tools/lib/machine')).Machine;
const src = fs.readFileSync(path.join(root, 'tools/statesave_test.js'), 'utf8');
const T_COM = Buffer.from(src.match(/const T_COM = Buffer\.from\(\n([\s\S]*?)'hex'\);/)[1].replace(/[\s'+,]/g, ''), 'hex');
let fail = 0;
const chk = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${msg}`); if (!ok) fail++; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
async function idle(M) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cross_idle_'));
    fs.writeFileSync(path.join(d, 'IDLE.COM'), Buffer.from([0xEB, 0xFE])); fs.writeFileSync(path.join(d, 'IDLE.BAT'), 'IDLE.COM\r\n');
    const m = await M.boot({ dir: d, bat: 'IDLE.BAT' }); m.runFrames(1); return m;
}
async function run(Asrc, Bdst, label) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross_'));
    fs.writeFileSync(path.join(dir, 'T.COM'), T_COM);
    fs.writeFileSync(path.join(dir, 'DATA.BIN'), Buffer.from(Array.from({ length: 94 }, (_, i) => 0x21 + i)));
    fs.writeFileSync(path.join(dir, 'RUN.BAT'), 'T.COM\r\n');
    const A = await Asrc.boot({ dir, bat: 'RUN.BAT' }); A.runFrames(300);
    const s = await A.stateSave({ gameId: 'cross' });
    const at = { frame: A.frame, produced: A.produced };
    const pa = A.captureAudio(300 / 56.42), ta = A.textVram(), ha = A.screenHash();
    const B = await idle(Bdst);
    const r = await B.stateLoad(s.bytes);
    B.frame = at.frame; B.produced = at.produced;
    const pb = B.captureAudio(300 / 56.42), tb = B.textVram(), hb = B.screenHash();
    console.log(`[${label}] wasm ${A.info().wasm.sha256.slice(0, 12)} → ${B.info().wasm.sha256.slice(0, 12)} / qbRev ${s.header.qbRev} → ${B.M.ccall('np2kai_build_rev', 'string', [], [])}`);
    chk(A.info().wasm.sha256 !== B.info().wasm.sha256, '別のビルド (wasm の SHA が違う)');
    chk(r.ok, `読み込みが成功 (${r.reason || ''} ${r.detail || ''})`);
    chk(ta[0] === tb[0] && ta[1] === tb[1] && ha === hb, `画面が一致 (${ta[0].slice(0, 4)} / ${tb[0].slice(0, 4)})`);
    chk(same(pa, pb), `音声が全区間一致 (${pa.length / 2} サンプル)`);
}
(async () => {
    await run(Here, There, '今のビルド → 別ビルド');
    await run(There, Here, '別ビルド → 今のビルド');
    console.log(fail ? `\nFAIL (${fail})` : '\nOK — ビルドをまたいで読める');
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
EOF
