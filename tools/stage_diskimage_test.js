#!/usr/bin/env node
// stage_diskimage_test.js — stage.js のディスクイメージ入力 (MCP 計画 B2) の回帰。
//
// 見るもの:
//   1. 実 FAT12 .hdm (np2tool/npmouse) を stageInput → 既知の中身 (readme.txt 2425B) と
//      サブディレクトリ (WNT/) がディスク上に展開される
//   2. 実 FAT12 .hdm (hostdrvnt) → planLaunch --exe が合成 .bat まで通る
//   3. 自己起動 .d88 (loader.d88 = 非 FAT) は reason 込みの正直な失敗
//   4. E2E: 合成 FAT12 2HD .hdm に実 VZ.COM (BSD-3、tools/testdata) を載せ、
//      stageInput → planLaunch → Machine.boot で VZ が起動する ("Illegal mode!" 無し)
//
// 素材: core/np2kai/np2tool/*.hdm (submodule)・tools/testdata/VZ.COM。無ければ SKIP。
// 使い方: node tools/stage_diskimage_test.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { Machine } = require('./lib/machine');
const { stageInput, planLaunch } = require('./lib/stage');

const NPMOUSE = path.join(ROOT, 'core/np2kai/np2tool/npmouse/npmouse.hdm');
const HOSTDRV = path.join(ROOT, 'core/np2kai/np2tool/hostdrvnt/hstdrvnt.hdm');
const LOADER = path.join(ROOT, 'web/assets/loader.d88');
const VZCOM = path.join(ROOT, 'tools/testdata/VZ.COM');

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

/* --- 合成 FAT12 2HD (PC-98: 1024B × 8sec × 2head × 77cyl)。ルート直下に files を置く。
 *     イメージ自体は合成だが、フォーマットは diskimage.js の readFat が実 .hdm に使うのと
 *     同一契約 (FAT12 パリティは reader の fatEntry と厳密に対)。 --- */
function synthFat12Hdm(files) {
    const bps = 1024, spc = 1, reserved = 1, nfat = 2, spf = 2, rootEnt = 192, totalSec = 1232;
    const img = new Uint8Array(totalSec * bps);
    const dv = new DataView(img.buffer);
    img.set([0xeb, 0x3c, 0x90], 0);
    img.set([...'QUUBEE  '].map((c) => c.charCodeAt(0)), 3);
    dv.setUint16(0x0b, bps, true); img[0x0d] = spc;
    dv.setUint16(0x0e, reserved, true); img[0x10] = nfat;
    dv.setUint16(0x11, rootEnt, true); dv.setUint16(0x13, totalSec, true);
    img[0x15] = 0xfe; dv.setUint16(0x16, spf, true);
    const fat = new Uint8Array(spf * bps);
    const fatSet = (i, v) => {
        const o = (i * 3) >> 1;
        if (i & 1) { fat[o] = (fat[o] & 0x0f) | ((v << 4) & 0xf0); fat[o + 1] = (v >> 4) & 0xff; }
        else { fat[o] = v & 0xff; fat[o + 1] = (fat[o + 1] & 0xf0) | ((v >> 8) & 0x0f); }
    };
    fatSet(0, 0xffe); fatSet(1, 0xfff);
    const rootStart = (reserved + nfat * spf) * bps;
    const dataStartSec = reserved + nfat * spf + Math.ceil((rootEnt * 32) / bps);
    let nextCl = 2, ei = 0;
    for (const f of files) {
        const clusters = Math.max(1, Math.ceil(f.data.length / (spc * bps)));
        for (let i = 0; i < clusters; i++)
            fatSet(nextCl + i, i === clusters - 1 ? 0xfff : nextCl + i + 1);
        img.set(f.data, (dataStartSec + (nextCl - 2) * spc) * bps);
        const [base, ext] = f.name.split('.');
        const e = new Uint8Array(32).fill(0x20, 0, 11);
        e.set([...base].map((c) => c.charCodeAt(0)), 0);
        if (ext) e.set([...ext].map((c) => c.charCodeAt(0)), 8);
        e[0x0b] = 0x20;
        const edv = new DataView(e.buffer);
        edv.setUint16(0x18, ((1992 - 1980) << 9) | (8 << 5) | 4, true);
        edv.setUint16(0x1a, nextCl, true);
        edv.setUint32(0x1c, f.data.length, true);
        img.set(e, rootStart + ei * 32);
        nextCl += clusters; ei++;
    }
    for (let fi = 0; fi < nfat; fi++) img.set(fat, (reserved + fi * spf) * bps);
    return img;
}

(async () => {
    const cleanups = [];
    let wasmSha = '';
    try {
        // ---- 1. 実 FAT12 .hdm → stageInput (サブディレクトリ込み) ----
        if (fs.existsSync(NPMOUSE)) {
            const st = await stageInput(NPMOUSE);
            cleanups.push(st.cleanup);
            const readme = path.join(st.dir, 'README.TXT');
            check('npmouse.hdm: README.TXT が 2425B で展開される',
                fs.existsSync(readme) && fs.statSync(readme).size === 2425);
            const wnt = path.join(st.dir, 'WNT');
            check('npmouse.hdm: サブディレクトリ WNT/ が中身ごと展開される',
                fs.existsSync(wnt) && fs.statSync(wnt).isDirectory() &&
                fs.readdirSync(wnt).length > 0);
        } else console.log('  (skip) npmouse.hdm 不在 (submodule)');

        // ---- 2. 実 FAT12 .hdm → planLaunch --exe ----
        if (fs.existsSync(HOSTDRV)) {
            const st = await stageInput(HOSTDRV);
            cleanups.push(st.cleanup);
            const plan = planLaunch(st.dir, { exe: 'HDRVMNT.EXE' });
            check('hstdrvnt.hdm: planLaunch --exe が合成 .bat まで通る',
                /exe:HDRVMNT\.EXE/i.test(plan.label) && !!plan.bat);
        } else console.log('  (skip) hstdrvnt.hdm 不在 (submodule)');

        // ---- 3. 自己起動 .d88 (非 FAT) は正直な失敗 ----
        if (fs.existsSync(LOADER)) {
            let err = null;
            try { const st = await stageInput(LOADER); cleanups.push(st.cleanup); }
            catch (e) { err = e; }
            check('loader.d88 (自己起動・非 FAT): reason 込みで正直に失敗する',
                !!err && /No FAT filesystem/.test(err.message), err && err.message);
        } else console.log('  (skip) loader.d88 不在');

        // ---- 4. E2E: 合成 FAT12 .hdm + 実 VZ.COM → Machine.boot ----
        if (fs.existsSync(VZCOM) && fs.existsSync(LOADER)) {
            const os = require('os');
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qbsdi-'));
            cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
            const hdm = path.join(tmp, 'vzdisk.hdm');
            fs.writeFileSync(hdm, synthFat12Hdm(
                [{ name: 'VZ.COM', data: new Uint8Array(fs.readFileSync(VZCOM)) }]));
            const st = await stageInput(hdm);
            cleanups.push(st.cleanup);
            check('合成 .hdm: VZ.COM がバイト一致で展開される',
                fs.existsSync(path.join(st.dir, 'VZ.COM')) &&
                Buffer.compare(fs.readFileSync(path.join(st.dir, 'VZ.COM')),
                    fs.readFileSync(VZCOM)) === 0);
            const plan = planLaunch(st.dir, {});
            check('合成 .hdm: 単一 exe の自動解決', /exe:VZ\.COM/i.test(plan.label));
            const m = await Machine.boot({ dir: st.dir, bat: plan.bat });
            wasmSha = m.info().wasm.sha256.slice(0, 16);
            for (let f = 0; f < 600 && !m.exited(); f++) m.runFrames(1);
            const text = m.textVram().join('\n');
            check('VZ がディスクイメージ経由で起動する (Illegal mode! 無し)',
                !/Illegal mode!/.test(text));
            check('VZ が画面を描いて入力待ちになる',
                !m.exited() && /[^\s]/.test(text));
        } else console.log('  (skip) VZ.COM か loader.d88 不在');
    } finally {
        for (const c of cleanups) { try { c(); } catch (_) {} }
    }
    console.log(`\nstage_diskimage_test: ${pass} PASS / ${fail} FAIL` +
        (wasmSha ? `  (wasm ${wasmSha})` : ''));
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
