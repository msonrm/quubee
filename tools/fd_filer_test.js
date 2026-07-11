#!/usr/bin/env node
// fd_filer_test.js — 出射厚のファイラー FD Ver.3.13 (fd98_313) がファイル一覧まで描画する回帰。
//
// 経緯 (2026-07-12): FD は「ドライブの指定が違います」で停止していた。真因と修正:
//   1. IOCTL AH=44h AL=09h (drive remote?) 未実装 → A: すら無効判定。
//      **A: をリモート (bit12=1) と返す**ことで解決 (実 FAT を持たない HLE-FS は network/CD 相当が faithful)。
//   2. FD はローカルドライブだと「ディレクトリを直接セクタ読み」する経路に入り、実 FAT の無い
//      我々では一覧を作れない。リモート判定にすると ver3.12 で追加された「DOS ファンクション
//      (FindFirst) を使う経路」に切り替わり、実装済み INT 21h で一覧が出る (fd98_313.doc 記載)。
//   3. リモート一貫のため AH=32h (Get DPB) は invalid drive、AH=60h truename / AH=37h switch char も実装。
//
// 素材 games/mem_test/fd98_313.lzh (ローカル限定・再配布不可)。無ければ SKIP。
// 見るもの: ①FindFirst/Next が呼ばれる (DOS ファンクション経路) ②画面に FD バージョン文字列と
//   ファイル名 (FD98.COM 等) とファンクションキーメニューが出る ③未実装 INT 21h ゼロ。

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { Machine } = require('./lib/machine');
const { stageInput, planLaunch } = require('./lib/stage');

const LZH = path.join(ROOT, 'games', 'mem_test', 'fd98_313.lzh');
if (!fs.existsSync(LZH)) { console.log('SKIP — games/mem_test/fd98_313.lzh 不在 (ローカル限定素材)'); process.exit(0); }

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
    const staged = await stageInput(LZH);
    try {
        const plan = planLaunch(staged.dir, { exe: 'FD98.COM', args: '' });
        const m = await Machine.boot({ dir: staged.dir, bat: plan.bat });
        m.runFrames(2500);

        const stats = m.int21Stats();
        check('未実装 INT 21h を踏まない', Object.keys(stats.unimplemented).length === 0,
            JSON.stringify(stats.unimplemented));
        check('FindFirst/Next で列挙する (DOS ファンクション経路)',
            (stats.calls['4E'] || 0) >= 1 && (stats.calls['4F'] || 0) >= 1,
            `4E=${stats.calls['4E']} 4F=${stats.calls['4F']}`);

        const screen = m.textVram().join('\n');
        check('FD バージョン文字列が出る', /FD Version 3\.13/.test(screen), screen.slice(0, 120));
        check('ファイル一覧に FD98/FDCUST2 が出る', /FD98/.test(screen) && /FDCUST2/.test(screen));
        check('カレントパス A:\\ を表示', /Path=A:\\/.test(screen));
        check('ファンクションキーメニューが出る', /Logdsk/.test(screen) && /Unpack/.test(screen));
    } finally {
        staged.cleanup();
    }

    console.log(`\nfd_filer_test: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL —', e.message || e); process.exit(1); });
