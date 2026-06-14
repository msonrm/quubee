#!/usr/bin/env node
// MPU-PC98 (MPU98II) → VERMOUTH 結線 (B, 2026-06-13) の headless 検証。
//
// 背景: huma_ts2 (東方封魔録) 等の「MIDI(MPU)」モードは、ゲームの MIDI ドライバ (KAJA MMD) が
//   MPU-PC98 (I/O 0xE0D0) を直接叩く。RS-MIDI (シリアル 8251) 経路とは別系統。
//   従来は np2cfg.mpuenable=0 で 0xE0D0 が未 attach のため MIDI モードが無音だった。
//   修正で enable_midi_now() が MPU98II も限定有効化し、commng_create(MPU98II) が VERMOUTH に
//   結線されるようになった (qb_commng.c)。
//
// 何を確かめるか: MMD の代わりに MPU-401 UART へ直接書く極小 COM を 1 つ走らせ、
//   1) MIDI 有効化前 (= boot 直後・mpuenable=0) は 0xE0D0 が無反応で無音、
//   2) enable_midi_now + reset 後は MPU 経由の note-on が VERMOUTH で合成され audio peak > 0、
//   3) reset を跨いだ 2 サイクル目でも鳴り続ける (毎リセットで cmmidi を再登録する回帰)
//   を確認する。
//
// 極小 COM (org 0x100):
//     mov dx,0E0D2h / mov al,3Fh / out dx,al   ; MPU を UART モードへ (mpucmd_3f → mpu98.mode=1)
//     mov dx,0E0D0h
//     mov al,90h / out dx,al                   ; note-on, ch0
//     mov al,40h / out dx,al                   ; note 64
//     mov al,7Fh / out dx,al                   ; velocity 127
//     jmp $                                    ; hang (note を保持したままフレームを回す)
//
// ローカル限定: freepats は再配布不可でコミットしない。不在なら SKIP。
// 使い方: node tools/mpu_midi_test.js

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

// MPU-401 UART へ note-on を 1 発撃って hang する極小 COM。
const MPU_NOTEON_COM = new Uint8Array([
    0xBA, 0xD2, 0xE0,   // mov dx, 0E0D2h   (MPU command port)
    0xB0, 0x3F,         // mov al, 3Fh      (UART mode)
    0xEE,               // out dx, al
    0xBA, 0xD0, 0xE0,   // mov dx, 0E0D0h   (MPU data port)
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

    // ---- soundfont を MEMFS へ (TSF が CWD の soundfont.sf2 を読む) ----
    M.FS.writeFile('/tmp/soundfont.sf2', new Uint8Array(fs.readFileSync(SF2)));

    const handle = M.ccall('np2kai_create', 'number', [], []);
    if (!handle) { console.error('np2kai_create failed'); process.exit(1); }

    const runFrame = M.cwrap('np2kai_run_frame', null, ['number']);
    const fillFn   = M.cwrap('np2kai_audio_fill', null, ['number', 'number', 'number']);
    const bufsize  = M.ccall('np2kai_audio_get_bufsize', 'number', ['number'], [handle]) || 2048;
    const aptr     = M._malloc(bufsize * 2 * 2);
    M.FS.writeFile('/tmp/loader.d88', new Uint8Array(fs.readFileSync(LOADER)));

    function stageCom() {
        const ptr = M._malloc(MPU_NOTEON_COM.length);
        M.HEAPU8.set(MPU_NOTEON_COM, ptr);
        const r = M.ccall('np2kai_dos_stage_com', 'number',
            ['number', 'number', 'string', 'string'],
            [ptr, MPU_NOTEON_COM.length, '', 'mpu_noteon']);
        M._free(ptr);
        if (r !== 0) { console.error('stage_com failed r=' + r); process.exit(1); }
    }

    function runCycle(label) {
        stageCom();
        M.ccall('np2kai_insert_fdd', 'number', ['number', 'string', 'number', 'number'], [handle, '/tmp/loader.d88', 0, 0]);
        M.ccall('np2kai_reset', null, ['number'], [handle]);
        let peak = 0;
        const TOTAL = 400;   // ~7s @56Hz: COM が note-on 後 hang する間の合成出力を拾う
        for (let f = 0; f < TOTAL; f++) {
            runFrame(handle);
            if (f % 4 === 0) {
                fillFn(handle, aptr, bufsize);
                const pcm = new Int16Array(M.HEAPU8.buffer, aptr, bufsize * 2);
                for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; }
            }
        }
        console.log(`[${label}] audio peak=${peak}/32767`);
        return peak;
    }

    // ---- ① MIDI 無効のまま (mpuenable=0): 0xE0D0 未 attach → 無音のはず ----
    const peakOff = runCycle('MIDI OFF (mpuenable=0)');

    // ---- ② enable_midi_now (= bridge.js ensureMidiLoaded の C 呼び出し): VERMOUTH + MPU98II 有効化 ----
    const midiOk = M.ccall('np2kai_enable_midi_now', 'number', ['number'], [handle]);
    console.log('enable_midi_now → VERMOUTH ロード =', !!midiOk);

    const peakOn1 = runCycle('MIDI ON cycle1 (MPU→VERMOUTH)');
    const peakOn2 = runCycle('MIDI ON cycle2 (reset 跨ぎ)');
    console.log('---');

    // 注: loader ブートの初期トランジェント (FM/PSG init) で MPU 非関与でも peak≈2048 の baseline が出る
    // (no-op COM でも同値。/tmp/baseline_probe で確認済)。よって「OFF=厳密無音」ではなく
    //   - OFF (mpuenable=0): MPU への OUT が no-op = baseline 止まり (note は合成されない)
    //   - ON: baseline + note-on の合成ピークが上乗せされ明確に超える
    // を delta で判定する。
    const BASELINE_MAX = 2200;   // OFF baseline (~2048) の許容上限。これを超えたら 0xE0D0 が無効時に反応した
    const AUDIBLE      = 4000;   // ON 期待ピークの下限 (baseline を十分上回る note-on)
    const DELTA_MIN    = 1500;   // ON が OFF baseline を上回る最小差分
    const passOff = peakOff <= BASELINE_MAX;
    const passOn  = midiOk
        && peakOn1 >= AUDIBLE && peakOn2 >= AUDIBLE
        && (peakOn1 - peakOff) >= DELTA_MIN && (peakOn2 - peakOff) >= DELTA_MIN;
    if (passOff && passOn) {
        console.log('PASS — MPU-PC98 (0xE0D0) → VERMOUTH 結線成立: MIDI OFF=baseline 止まり (note 非合成) / '
            + 'ON=note-on を合成 / reset 跨ぎでも継続');
        process.exit(0);
    }
    if (!passOff) console.log(`  ★ MIDI OFF で peak=${peakOff} > ${BASELINE_MAX} = 0xE0D0 が無効時にも note を合成? (限定有効化が崩れている)`);
    if (!midiOk)  console.log('  ★ enable_midi_now 失敗 (freepats 確認)');
    if (midiOk && (peakOn1 < AUDIBLE || peakOn1 - peakOff < DELTA_MIN)) console.log(`  ★ cycle1 が baseline 止まり (peak=${peakOn1}) = MPU→VERMOUTH 未結線`);
    if (midiOk && (peakOn2 < AUDIBLE || peakOn2 - peakOff < DELTA_MIN)) console.log(`  ★ cycle2 が baseline 止まり (peak=${peakOn2}) = reset 跨ぎの再登録バグ`);
    console.log('FAIL', { peakOff, peakOn1, peakOn2 });
    process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
