// 汎用 .bat 分岐インタプリタ デバッガ (展開済み dir + .bat 名を指定):
//   node qb_bat_debug.js <展開済みdir> <batname> [frames] [keyspec]
// keyspec = "frame:nkey,frame:nkey,..." (PC-98 NKEY 16進)。例 "1200:34" = frame1200 で Space。
// printErr の [batch]/EXEC ログを表示し、500 フレーム毎に colors を出す。
const fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const bat = require(path.join(WEB, 'player', 'batscript.js'));
const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

const SRC = process.argv[2];
const BATNAME = process.argv[3];
const FRAMES = parseInt(process.argv[4] || '6000', 10);
const KEYS = new Map();
if (process.argv[5]) {
    for (const kv of process.argv[5].split(',')) {
        const [f, k] = kv.split(':');
        KEYS.set(parseInt(f, 10), parseInt(k, 16));
    }
}

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {},
        printErr: (s) => console.log('[err] ' + s) });
    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/font.bmp'))));
    const handle = M.ccall('np2kai_create', 'number', [], []);
    try { M.FS.mkdir('/run'); } catch (_) {}
    const names = [];
    for (const nameBuf of fs.readdirSync(SRC, { encoding: 'buffer' })) {
        const hostPath = Buffer.concat([Buffer.from(SRC + '/'), nameBuf]);
        let data; try { data = fs.readFileSync(hostPath); } catch (_) { continue; }
        const memName = nameBuf.toString('latin1');
        M.FS.writeFile('/run/' + memName, new Uint8Array(data));
        names.push(memName);
    }

    const batName = names.find((n) => n.toLowerCase() === BATNAME.toLowerCase());
    if (!batName) { console.log('bat not found: ' + BATNAME); process.exit(1); }
    const recipe = bat.parse(M.FS.readFile('/run/' + batName));
    console.log('hasControlFlow =', recipe.hasControlFlow);
    const stmts = bat.buildStatements(recipe, names, process.env.ARGS || '');
    if (!stmts) { console.log('buildStatements null'); process.exit(1); }
    stmts.forEach((s, i) => console.log(
        `  [${i}] ${s.op} ${s.op === 'cmd' ? s.name + ' ' + s.args :
            s.op === 'echo' ? JSON.stringify(s.text.slice(0, 40)) :
            s.op === 'goto' ? '->' + s.target : `n=${s.n} neg=${s.neg} ->${s.target}`}`));
    const prog = Buffer.from(bat.serializeStatements(stmts), 'latin1');
    const ptr = M._malloc(prog.length); M.HEAPU8.set(prog, ptr);
    const r = M.ccall('np2kai_dos_stage_batch', 'number',
        ['number', 'number', 'string'], [ptr, prog.length, batName.toUpperCase()]);
    M._free(ptr);
    console.log('stage_batch r =', r);
    if (r !== 0) process.exit(1);

    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(path.join(WEB, 'assets/loader.d88'))));
    M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'],
        [handle, '/tmp/loader.d88', 0, 0]);
    M.ccall('np2kai_reset', null, ['number'], [handle]);
    if (process.env.TRACE) M.ccall('np2kai_dos_set_int21_trace', null, ['number'], [1]);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const getExit = M.cwrap('np2kai_dos_get_exit', 'number', ['number']);
    const getFB = M.cwrap('np2kai_get_framebuffer', 'number', ['number', 'number', 'number', 'number']);
    const keyDown = M.cwrap('np2kai_key_down', null, ['number', 'number']);
    const keyUp = M.cwrap('np2kai_key_up', null, ['number', 'number']);
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
    let held = -1, heldUntil = 0;
    for (let f = 0; f < FRAMES; f++) {
        if (KEYS.has(f)) { held = KEYS.get(f); keyDown(handle, held); heldUntil = f + 8;
            console.log(`--- frame ${f}: key 0x${held.toString(16)} down`); }
        if (held >= 0 && f >= heldUntil) { keyUp(handle, held); held = -1; }
        runFrame(handle);
        if (f % 500 === 499) console.log(`frame ${f + 1}: colors=${fbColors()} pc=0x${(linPc(handle) >>> 0).toString(16)}`);
        if (getExit(0)) { console.log(`EXIT at frame ${f}`); break; }
    }
    console.log(`final: colors=${fbColors()} pc=0x${(linPc(handle) >>> 0).toString(16)}`);
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
