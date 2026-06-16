#!/usr/bin/env node
// PMD (.M) を HLE-DOS で実演奏する Path B の headless 回帰 (2026-06-15)。
//
// 何を確かめるか:
//   本物の KAJA PMD ドライバを常駐 → PMP で .M をロード&演奏 → 常駐 ISR (OPNA タイマ IRQ12)
//   が IF=1 アイドルで刻み続け、steady-state で音が鳴ること。
//   依存する2つの修正:
//     1) native/bridge.c: np2cfg.snd86opt |= 0x0C (86 ボードを INT5/IRQ12 に。PMD が hook する
//        割り込みベクタ INT 0x14 と board が assert する IRQ を一致させる)
//     2) tools/dos_loader/shell.asm .done: AH=4Ch 終了でなく sti + hlt アイドル
//        (常駐演奏ドライバの ISR が IF=1 で刻み続けるように)
//   どちらか欠けると「最初の1音だけ鳴って無音」になる (peak は出るが rms(late)≈0)。
//
// ローカル限定: PMD/PMP/曲は再配布不可の書庫からその場で展開。不在なら SKIP (CI 安全)。
//   driver = games/touhou/huma_ts2.lzh の pmd86.com / player = games/pmd48o.lzh の pmp.com /
//   曲 = games/th5_12pmd.lzh の th5_12.M。展開には lha/lhasa。
//
// 使い方: node tools/pmd_test.js

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT   = path.join(__dirname, '..');
const WEB    = path.join(ROOT, 'web');
const LOADER = path.join(WEB, 'assets', 'loader.d88');
const FONT   = path.join(WEB, 'assets', 'font.bmp');

const SRC = [
    { arc: path.join(ROOT, 'games', 'touhou', 'huma_ts2.lzh'), member: 'pmd86.com', as: 'PMD86.COM' },
    { arc: path.join(ROOT, 'games', 'pmd48o.lzh'),             member: 'pmp.com',   as: 'PMP.COM'   },
    { arc: path.join(ROOT, 'games', 'th5_12pmd.lzh'),          member: 'th5_12.M',  as: 'TH5_12.M'  },
];

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');
for (const s of SRC) if (!fs.existsSync(s.arc)) skip(path.basename(s.arc) + ' 不在 (ローカル限定テスト)');

// 各書庫から必要メンバを一時ディレクトリへ展開 (lha → 無ければ lhasa)。
const TMP = fs.mkdtempSync('/tmp/pmd_test_');
function extract(arc, member, as) {
    try { cp.execSync(`lha xfgw=${TMP} "${arc}" "${member}"`, { stdio: 'ignore' }); }
    catch (_) {
        try { cp.execSync(`cd ${TMP} && lhasa e "${arc}" "${member}"`, { stdio: 'ignore', shell: '/bin/bash' }); }
        catch (e2) { skip(`展開失敗 ${path.basename(arc)}:${member} — ${e2.message}`); }
    }
    // lha は member のパス構成 (例 bin/pmp.com) で出すことがある → basename で探す
    let found = path.join(TMP, member);
    if (!fs.existsSync(found)) {
        const base = path.basename(member);
        const hit = (function walk(d) {
            for (const e of fs.readdirSync(d)) {
                const p = path.join(d, e);
                if (fs.statSync(p).isDirectory()) { const r = walk(p); if (r) return r; }
                else if (e.toLowerCase() === base.toLowerCase()) return p;
            }
            return null;
        })(TMP);
        if (!hit) skip(`展開後に ${member} が見つからない`);
        found = hit;
    }
    return fs.readFileSync(found);
}

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
const latin1 = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };

(async () => {
    const files = SRC.map((s) => ({ name: s.as, data: extract(s.arc, s.member, s.as) }));

    let pass = 0, fail = 0;
    const chk = (cond, msg) => { if (cond) { pass++; console.log(`  PASS: ${msg}`); } else { fail++; console.log(`  FAIL: ${msg}`); } };

    // fmgen=1 (既定) と fmgen=0 (opngen) の両エンジンで鳴ることを確認 (タイマ IRQ は両者 opntimer 経由)。
    async function playOnce(useFmgen) {
        const M = await NP2KaiModule({ noInitialRun: true, locateFile: (p) => path.join(WEB, p), print: () => {}, printErr: () => {} });
        M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
        M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
        M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));
        const handle = M.ccall('np2kai_create', 'number', [], []);
        if (!handle) throw new Error('create failed');
        M.ccall('np2kai_set_fmgen', 'number', ['number'], [useFmgen ? 1 : 0]);

        try { M.FS.mkdir('/run'); } catch (_) {}
        for (const f of files) M.FS.writeFile('/run/' + f.name, new Uint8Array(f.data));

        const seq = ['PMD86.COM\t', 'PMP.COM\tTH5_12.M'];
        const sbuf = latin1(seq.join('\n') + '\n');
        const sptr = M._malloc(sbuf.length); M.HEAPU8.set(sbuf, sptr);
        const sr = M.ccall('np2kai_dos_stage_script', 'number', ['number', 'number', 'string'], [sptr, sbuf.length, 'pmd']);
        M._free(sptr);
        if (sr !== 0) throw new Error('stage_script r=' + sr);

        M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
        M.ccall('np2kai_set_pmd_irq', 'number', ['number'], [1]);   // 音楽セッション = 86 ボードを IRQ12 に (reset 前)
        M.ccall('np2kai_reset', null, ['number'], [handle]);

        const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
        const fillFn   = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
        const bufsize  = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
        const aptr     = M._malloc(bufsize * 2 * 2);
        let peakLate = 0, sumSqLate = 0, nLate = 0;
        const TOTAL = 1800;     // ~32s @56Hz
        for (let f = 0; f < TOTAL; f++) {
            runFrame(handle);
            if (f % 4 === 0 && f >= 1200) {   // steady-state 区間 (常駐演奏が回り続けているか)
                fillFn(handle, aptr, bufsize);
                const pcm = new Int16Array(M.HEAPU8.buffer, aptr, bufsize * 2);
                for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peakLate) peakLate = a; sumSqLate += pcm[i] * pcm[i]; nLate++; }
            }
        }
        M._free(aptr);
        return { peakLate, rmsLate: nLate ? Math.sqrt(sumSqLate / nLate) : 0 };
    }

    const fm = await playOnce(true);
    console.log(`fmgen : peak(late)=${fm.peakLate} rms(late)=${fm.rmsLate.toFixed(1)}`);
    chk(fm.peakLate > 4000 && fm.rmsLate > 500, 'fmgen で steady-state 演奏 (常駐 ISR が IF=1 で刻み続ける)');

    const op = await playOnce(false);
    console.log(`opngen: peak(late)=${op.peakLate} rms(late)=${op.rmsLate.toFixed(1)}`);
    chk(op.peakLate > 4000 && op.rmsLate > 500, 'opngen で steady-state 演奏');

    console.log(`\npmd_test: pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
