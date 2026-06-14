#!/usr/bin/env node
// RS-MIDI (シリアル) → TinySoundFont 結線 (A, 2026-06-05) の headless 検証。
//
// 何を確かめるか:
//   TW212 の TWMIDI.BAT (= `middrv -X1 -t3` / `twins2` / `middrv -r`) を、bridge.js と同じ
//   「② ミニ COMMAND.COM で 1 セッション逐次 EXEC」経路で起動し、
//     1) RS-MIDI ルーティングが生きているか (qb_serial_midi_active)
//     2) MIDDRV が実際にシリアルへ MIDI バイトを送出し、我々が捕捉したか (qb_serial_midi_bytes > 0)
//     3) その結果 TinySoundFont が非無音の PCM を出すか (audio RMS > 0)
//   を確認する。従来 (com_nc) は 1=false / 2=0 / 3=無音 だった。
//
// ローカル限定: ゲーム書庫 (TW212.LZH) と freepats は再配布不可でコミットしない (project 方針)。
//   どちらか不在なら SKIP する (CI でも安全)。展開には lha/lhasa を使う。
//
// 使い方: node tools/midi_serial_test.js

const path = require('path');
const fs   = require('fs');
const cp   = require('child_process');

const ROOT     = path.join(__dirname, '..');
const WEB      = path.join(ROOT, 'web');
const GAME_LZH = path.join(ROOT, 'games', 'bio_100', 'TW212.LZH');
const SF2      = path.join(WEB, 'assets', 'soundfont.sf2');
const FONT     = path.join(WEB, 'assets', 'font.bmp');
const LOADER   = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(GAME_LZH)) skip('TW212.LZH 不在 (ローカル限定テスト)');
if (!fs.existsSync(SF2))      skip('soundfont.sf2 不在 (tools/setup_soundfont.sh)');
if (!fs.existsSync(LOADER))   skip('loader.d88 不在 (tools/dos_loader/build.sh)');

// TW212.LZH を一時ディレクトリへ展開 (lha が無ければ lhasa)。
const TMP = fs.mkdtempSync('/tmp/tw212_midi_');
try {
    try { cp.execSync(`lha xgw=${TMP} "${GAME_LZH}"`, { stdio: 'ignore' }); }
    catch (_) { cp.execSync(`cd ${TMP} && lhasa e "${GAME_LZH}"`, { stdio: 'ignore', shell: '/bin/bash' }); }
} catch (e) { skip('lha/lhasa での展開に失敗: ' + e.message); }
const gameFiles = fs.readdirSync(TMP).filter(f => fs.statSync(path.join(TMP, f)).isFile());
if (!gameFiles.some(f => /middrv\.exe$/i.test(f))) skip('展開に MIDDRV.EXE が無い');

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));
const bat          = require(path.join(WEB, 'player', 'batscript.js'));

// latin1 (1char=1byte) で文字列を Uint8Array へ。FS キー/script の符号化と一致させる。
const latin1 = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));

    // ---- soundfont を MEMFS へ (TSF が CWD の soundfont.sf2 を読む) ----
    const mkdir = (p) => { try { M.FS.mkdir(p); } catch (_) {} };
    M.FS.writeFile('/tmp/soundfont.sf2', new Uint8Array(fs.readFileSync(SF2)));
    console.log('soundfont.sf2 配置');

    // ---- 遅延 on-demand 経路を検証: MIDI OFF で create → 後から enable_midi_now → reset で結線 ----
    // (ブラウザ bridge.js と同じ順序。boot 時は MIDI OFF=即プレイ維持、MIDI レシピ Run 時のみ有効化)
    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    const active = () => M.ccall('np2kai_debug_serial_midi_active', 'number', ['number'], [handle]);
    const bytes  = () => M.ccall('np2kai_debug_serial_midi_bytes',  'number', ['number'], [handle]) >>> 0;
    const bootActive = !!active();
    console.log('create 直後 (MIDI OFF 期待): serial MIDI active =', bootActive);

    // ---- TW212 のファイルを /run/ へ (bridge.js の展開先と同じ。フラット書庫) ----
    mkdir('/run');
    const names = [];
    for (const f of gameFiles) {
        M.FS.writeFile('/run/' + f, new Uint8Array(fs.readFileSync(path.join(TMP, f))));
        names.push(f);
    }

    // ---- TWMIDI.BAT を解釈 → 逐次 EXEC 列 → stage_script (bridge.js stageAndRunScript と同形式) ----
    const batFile = gameFiles.find(f => /^twmidi\.bat$/i.test(f));
    if (!batFile) skip('TWMIDI.BAT が無い');
    const recipe = bat.parse(new Uint8Array(fs.readFileSync(path.join(TMP, batFile))));
    const seq = bat.resolveSequence(recipe, names, '');
    if (!seq) { console.error('resolveSequence が null (制御フロー入り?)'); process.exit(1); }
    console.log('twmidi 逐次列:', seq.map(c => `${c.name} ${c.args}`.trim()).join('  |  '));
    const scriptStr = seq.map(c => c.name + '\t' + (c.args || '')).join('\n') + '\n';
    const sbuf = latin1(scriptStr);
    const stageScript = () => {
        const sptr = M._malloc(sbuf.length); M.HEAPU8.set(sbuf, sptr);
        const sr = M.ccall('np2kai_dos_stage_script', 'number', ['number', 'number', 'string'], [sptr, sbuf.length, 'twmidi']);
        M._free(sptr);
        if (sr !== 0) { console.error('stage_script failed r=' + sr); process.exit(1); }
    };

    // ---- 遅延 MIDI 有効化 (= bridge.js ensureMidiLoaded の C 呼び出し)。冪等。 ----
    const midiOk = M.ccall('np2kai_enable_midi_now', 'number', ['number'], [handle]);
    console.log('enable_midi_now → TinySoundFont ロード =', !!midiOk);

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const keyDown  = M.cwrap('np2kai_key_down', null, ['number', 'number']);
    const keyUp    = M.cwrap('np2kai_key_up',   null, ['number', 'number']);
    const fillFn   = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
    const bufsize  = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
    const aptr     = M._malloc(bufsize * 2 * 2);
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));

    // 1 サイクル = bridge.js の 1 Run 相当 (stage→loader 挿入→reset→実行)。peak/byte 増分を測る。
    function runCycle(label) {
        stageScript();
        M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
        M.ccall('np2kai_reset', null, ['number'], [handle]);   // ← この reset で serial→TinySoundFont が結線される
        const tapKey = (code) => { keyDown(handle, code); for (let i = 0; i < 2; i++) runFrame(handle); keyUp(handle, code); };
        const startBytes = bytes();
        let peak = 0;
        const TOTAL = 1200;   // ~21s @56Hz
        for (let f = 0; f < TOTAL; f++) {
            runFrame(handle);
            if (f % 8 === 0) { fillFn(handle, aptr, bufsize); const pcm = new Int16Array(M.HEAPU8.buffer, aptr, bufsize * 2); for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; } }
            if (f === 300 || f === 700) tapKey(0x1c);   // Enter (タイトル送り)
            if (f === 500)              tapKey(0x34);   // Space
        }
        const dBytes = bytes() - startBytes;
        console.log(`[${label}] active=${!!active()} MIDI bytes(増分)=${dBytes} audio peak=${peak}/32767`);
        return { active: !!active(), dBytes, peak };
    }

    // ---- ★ 2 サイクル実行: リセットを跨いで MIDI が鳴り続けるかの回帰 (com_serial 再登録) ----
    const c1 = runCycle('cycle1 MIDI');
    const c2 = runCycle('cycle2 MIDI (reset 跨ぎ)');
    console.log('---');

    const passC1 = !bootActive && midiOk && c1.active && c1.dBytes > 0 && c1.peak > 0;
    const passC2 = c2.active && c2.dBytes > 0 && c2.peak > 0;
    if (passC1 && passC2) {
        console.log('PASS — 遅延 on-demand 成立 + reset を跨いでも MIDI が鳴り続ける (毎リセットで com_serial を再登録)');
        process.exit(0);
    }
    if (bootActive)            console.log('  注意: boot 直後に active=true (MIDI 常時 ON?)');
    if (!midiOk)               console.log('  注意: enable_midi_now 失敗 (freepats 確認)');
    if (passC1 && !passC2)     console.log('  ★ cycle2 が無音 = reset 跨ぎの再登録バグ (sound_streamregist が復活していない)');
    console.log('FAIL', { c1, c2 });
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
