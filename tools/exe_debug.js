// 単一 EXE/COM 直ステージ実行デバッガ: node tools/exe_debug.js <dir> <exe> [cmdline] [frames]
// env: TRACE=1 (INT21 トレース) / PNG=path (終了時 framebuffer を PNG 出力)。終了時 text VRAM もダンプ。
const fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
const SRC = process.argv[2], EXE = process.argv[3];
const CMDLINE = process.argv[4] || '';
const FRAMES = parseInt(process.argv[5] || '2000', 10);

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {},
        printErr: (s) => { if (process.env.TRACE) console.log('[err] ' + s); } });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    try { M.FS.mkdir('/run'); } catch (_) {}
    for (const nameBuf of fs.readdirSync(SRC, { encoding: 'buffer' })) {
        const hostPath = Buffer.concat([Buffer.from(SRC + '/'), nameBuf]);
        let data; try { data = fs.readFileSync(hostPath); } catch (_) { continue; }
        M.FS.writeFile('/run/' + nameBuf.toString('latin1'), new Uint8Array(data));
    }
    const exe = new Uint8Array(fs.readFileSync(path.join(SRC, EXE)));
    const ptr = M._malloc(exe.length); M.HEAPU8.set(exe, ptr);
    const stageFn = /\.com$/i.test(EXE) ? 'np2kai_dos_stage_com' : 'np2kai_dos_stage_exe';
    const r = M.ccall(stageFn, 'number',
        ['number', 'number', 'string', 'string'], [ptr, exe.length, CMDLINE, EXE.toUpperCase()]);
    M._free(ptr);
    if (r !== 0) { console.log('stage failed r=' + r); process.exit(1); }
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);
    if (process.env.TRACE) M.ccall('np2kai_dos_set_int21_trace', null, ['number'], [1]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const getFB = M.cwrap('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number']);
    const linPc = M.cwrap('np2kai_debug_get_linear_pc', 'number', ['number']);
    const wP = M._malloc(4), hP = M._malloc(4), bP = M._malloc(4);
    const fbColors = () => {
        const p = getFB(handle, wP, hP, bP);
        const w = M.HEAP32[wP >> 2], h = M.HEAP32[hP >> 2];
        if (!p || w <= 0) return 0;
        const base = p >> 1, n = w * h, set = new Set();
        for (let i = 0; i < n; i += 17) set.add(M.HEAPU16[base + i]);
        return set.size;
    };
    let exited = 0;
    for (let f = 0; f < FRAMES; f++) {
        runFrame(handle);
        if (f % 500 === 499) console.log(`frame ${f + 1}: colors=${fbColors()} pc=0x${(linPc(handle) >>> 0).toString(16)}`);
        if (getExit(0)) { exited = 1; console.log(`EXIT at frame ${f}`); break; }
    }
    console.log(`final: colors=${fbColors()} exited=${exited}`);
    if (process.env.PNG) {
        const zlib = require('zlib');
        const crc32 = (buf) => { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
        const chunk = (t, dd) => { const l = Buffer.alloc(4); l.writeUInt32BE(dd.length, 0); const td = Buffer.concat([Buffer.from(t, 'latin1'), dd]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(td), 0); return Buffer.concat([l, td, cr]); };
        const p = getFB(handle, wP, hP, bP), w = M.HEAP32[wP >> 2], h = M.HEAP32[hP >> 2];
        const rgb = Buffer.alloc(w * h * 3), base = p >> 1;
        for (let i = 0; i < w * h; i++) { const px = M.HEAPU16[base + i]; rgb[i * 3] = ((px >> 11) & 0x1f) << 3; rgb[i * 3 + 1] = ((px >> 5) & 0x3f) << 2; rgb[i * 3 + 2] = (px & 0x1f) << 3; }
        const raw = Buffer.alloc((w * 3 + 1) * h);
        for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
        const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
        fs.writeFileSync(process.env.PNG, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
        console.log('png →', process.env.PNG, `${w}x${h}`);
    }
    const peek8 = M.cwrap('np2kai_debug_peek8', 'number', ['number', 'number']);
    for (let row = 0; row < 25; row++) {
        let line = '';
        for (let col = 0; col < 80; col++) {
            const b = peek8(handle, 0xA0000 + (row * 80 + col) * 2) & 0xff;
            line += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : (b ? '·' : ' ');
        }
        if (line.trim()) console.log(`vram${String(row).padStart(2)}: ${line.trimEnd()}`);
    }
})().catch((e) => { console.error(e); process.exit(1); });
