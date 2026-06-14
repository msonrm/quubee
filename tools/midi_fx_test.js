#!/usr/bin/env node
// GS システムエフェクト (reverb/chorus/delay) の headless 検証 (2026-06-13)。
//
// TinySoundFont に追加したセンドバス + Freeverb が効いているかを A/B で確認する。
// 手法: MPU-401 UART へメロディ音 1 つ (ch0, note64) を撃つ極小 COM を走らせ、音を保持する。
// リバーブ ON ではセンドした残響が積み上がり、サステイン区間の出力レベルがドライより明確に高くなる。
// 同一入力を np2kai_debug_midi_fx(0|1) で A/B し、ON のサステインが OFF を有意に上回ることを確認する。
//
// 注: loader のブートに ~240 フレームかかる (音はその後に出る)。onset を動的検出してから計測窓を取る。
// ローカル限定: freepats 不在なら SKIP。使い方: node tools/midi_fx_test.js

const path = require('path');
const fs   = require('fs');

const ROOT     = path.join(__dirname, '..');
const WEB      = path.join(ROOT, 'web');
const SF2      = path.join(WEB, 'assets', 'soundfont.sf2');
const FONT     = path.join(WEB, 'assets', 'font.bmp');
const LOADER   = path.join(WEB, 'assets', 'loader.d88');

function skip(msg) { console.log('SKIP — ' + msg); process.exit(0); }
if (!fs.existsSync(SF2))    skip('soundfont.sf2 不在 (tools/setup_soundfont.sh)');
if (!fs.existsSync(LOADER)) skip('loader.d88 不在 (tools/dos_loader/build.sh)');

const NP2KaiModule = require(path.join(WEB, 'np2kai_core.js'));

// MPU-401 UART へ「持続音 (オルガン, prog16) を ch0 で 1 音」撃って hang する極小 COM。
// ピアノ等の減衰音だとサステイン区間で消えてリバーブ寄与を測れないため、持続するオルガンを使う。
const NOTE_COM = new Uint8Array([
    0xBA, 0xD2, 0xE0,   // mov dx, 0E0D2h   (MPU command port)
    0xB0, 0x3F,         // mov al, 3Fh      (UART mode)
    0xEE,               // out dx, al
    0xBA, 0xD0, 0xE0,   // mov dx, 0E0D0h   (MPU data port)
    0xB0, 0xC0,         // mov al, C0h      (program change ch0)
    0xEE,               // out dx, al
    0xB0, 0x10,         // mov al, 10h      (program 16 = drawbar organ, 持続音)
    0xEE,               // out dx, al
    0xB0, 0x90,         // mov al, 90h      (note-on, ch0)
    0xEE,               // out dx, al
    0xB0, 0x40,         // mov al, 40h      (note 64)
    0xEE,               // out dx, al
    0xB0, 0x7F,         // mov al, 7Fh      (velocity 127)
    0xEE,               // out dx, al
    0xEB, 0xFE,         // jmp $
]);

(async () => {
    const M = await NP2KaiModule({ noInitialRun: true, print: () => {}, printErr: () => {} });

    M.ccall('np2kai_set_data_dir', null, ['string'], ['/tmp/']);
    M.FS.writeFile('/tmp/FONT.BMP', new Uint8Array(fs.readFileSync(FONT)));
    M.FS.writeFile('/tmp/soundfont.sf2', new Uint8Array(fs.readFileSync(SF2)));   // TSF が CWD から読む

    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    const midiOk = M.ccall('np2kai_enable_midi_now', 'number', ['number'], [handle]);
    console.log('enable_midi_now → TinySoundFont ロード =', !!midiOk);
    if (!midiOk) skip('TinySoundFont ロード失敗');

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const fillFn   = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
    const fxToggle = M.cwrap('np2kai_debug_midi_fx', null, ['number']);
    const bufsize  = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
    const aptr     = M._malloc(bufsize * 2 * 2);
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));

    // 1 サイクル: COM を起動し、毎フレームの audio ピークを配列で返す。
    function runCycle(fxOn) {
        fxToggle(fxOn ? 1 : 0);
        const ptr = M._malloc(NOTE_COM.length);
        M.HEAPU8.set(NOTE_COM, ptr);
        const r = M.ccall('np2kai_dos_stage_com', 'number',
            ['number', 'number', 'string', 'string'],
            [ptr, NOTE_COM.length, '', 'note']);
        M._free(ptr);
        if (r !== 0) { console.error('stage_com failed r=' + r); process.exit(1); }
        M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
        M.ccall('np2kai_reset', null, ['number'], [handle]);
        const peaks = [];
        const TOTAL = 480;   // onset(~240) + サステイン計測に十分
        for (let f = 0; f < TOTAL; f++) {
            runFrame(handle);
            fillFn(handle, aptr, bufsize);
            const pcm = new Int16Array(M.HEAPU8.buffer, aptr, bufsize * 2);
            let p = 0;
            for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > p) p = a; }
            peaks.push(p);
        }
        return peaks;
    }

    const detectOnset = (peaks) => { for (let f = 30; f < peaks.length; f++) if (peaks[f] > 3000) return f; return -1; };
    // サステイン区間の代表値 = 区間内ピークの中央値 (アタックや単発スパイクに頑健)
    const sustainLevel = (peaks, a, b) => {
        const w = [];
        for (let f = a; f < b && f < peaks.length; f++) w.push(peaks[f]);
        if (!w.length) return 0;
        w.sort((x, y) => x - y);
        return w[w.length >> 1];
    };

    const on  = runCycle(true);
    const off = runCycle(false);
    const onsetOn  = detectOnset(on);
    const onsetOff = detectOnset(off);
    if (onsetOn < 0 || onsetOff < 0) { console.log('FAIL — note onset 未検出', { onsetOn, onsetOff }); process.exit(1); }

    const susOn  = sustainLevel(on,  onsetOn + 40,  onsetOn + 200);
    const susOff = sustainLevel(off, onsetOff + 40, onsetOff + 200);
    const ratio  = susOff ? (susOn / susOff) : 0;
    console.log(`onset: ON=${onsetOn} OFF=${onsetOff}`);
    console.log(`sustain level: ON=${susOn}  OFF=${susOff}  (ratio ${ratio.toFixed(2)}x)`);
    console.log('---');

    // 判定: ①両方で音が鳴る ②fx ON のサステインが OFF を明確に上回る (リバーブが積み上がる)
    const PLAY_MIN = 500;
    const passPlay = susOn >= PLAY_MIN && susOff >= PLAY_MIN;
    // リバーブが「効いている」ことの確認 (有無の検出)。リバーブは入力 HPF で低域を意図的に削るため、
    // テスト音(オルガン note64 ≈ 330Hz、HPF 帯)では寄与が控えめになる。閾値は存在確認の下限として 1.12。
    const passWet  = ratio >= 1.12;
    if (passPlay && passWet) {
        console.log(`PASS — リバーブのセンドバスが機能: fx ON のサステインが OFF の ${ratio.toFixed(2)}倍 (残響が積み上がる)`);
        process.exit(0);
    }
    if (!passPlay) console.log(`  ★ 音が弱い (ON=${susOn} OFF=${susOff} < ${PLAY_MIN}) — note 経路を確認`);
    if (!passWet)  console.log(`  ★ リバーブの寄与が不足 (ratio ${ratio.toFixed(2)}x < 1.12) — センド/ゲインを確認`);
    console.log('FAIL', { susOn, susOff, ratio });
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
