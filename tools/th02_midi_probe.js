#!/usr/bin/env node
// th02_midi_probe.js — 東方封魔録 (TH02 体験版) の MIDI(MPU) モードが鳴るかを、音源ボード × クロック倍率で
// 調べる調査スクリプト (回帰テストではない。既知の未解決事象の再現用)。
//
// 事象 (2026-09-27 ユーザー報告・headless で再現): Sound Board = Mate-X PCM (0x64) かつ multiple=27
// (ブラウザ既定) だと、オプションで MUSIC=MIDI にしても MIDI が鳴らない (表示は MIDI のまま)。
// ちびおと (0x14) なら 27 でも鳴り、Mate-X でも 20 (headless 既定) なら鳴る。NP2kai 追従前の
// 旧ビルド (eebb95c0) でも同じ = 追従による退行ではない。MPU に note-on を直接送る極小 COM
// (mpu_midi_test.js) は全組み合わせで鳴る = MMD の使い方の側でつまずいている。原因は未調査。
//
// 手順: game.bat を MIDI 有効で起動 → タイトルで OPTION → MUSIC を右キーで MIDI に → FM/SSG/
// リズム/ADPCM を消音して 8 秒汲む。MIDI (TinySoundFont) だけの音量を見る。
//   目安 (2026-09-27): 鳴る = rms ~1950 / 鳴らない = rms ~750 (MIDI 以外の残り = 対照と同値)
//
// 素材 games/touhou/huma_ts2.lzh は再配布不可 (ローカル限定)。無ければ SKIP。
// 使い方: node tools/th02_midi_probe.js [boards=adpcm,matex] [multiples=20,27]

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { Machine, NKEY } = require('./lib/machine');

const LZH = path.join(__dirname, '..', 'games', 'touhou', 'huma_ts2.lzh');
if (!fs.existsSync(LZH)) { console.log('SKIP — games/touhou/huma_ts2.lzh 不在 (再配布不可・ローカル限定)'); process.exit(0); }
try { cp.execSync('command -v lha', { stdio: 'ignore' }); } catch (_) { console.log('SKIP — lha 不在'); process.exit(0); }

const boards = (process.argv[2] || 'adpcm,matex').split(',');
const multiples = (process.argv[3] || '20,27').split(',').map(Number);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'th02_midi_'));
cp.execSync(`lha xqw=${TMP} "${LZH}"`, { stdio: 'ignore' });

// タイトル到達 (~1500f) → OPTION (下 2 回 + RETURN) → MUSIC 行 (下) → 右で FM→MIDI
const KEYS = new Map([[1520, 'DOWN'], [1560, 'DOWN'], [1600, 'RETURN'], [1720, 'DOWN'], [1760, 'RIGHT']]);
const UNTIL = 1900;

(async () => {
    for (const soundboard of boards) {
        for (const multiple of multiples) {
            const m = await Machine.boot({ dir: TMP, bat: 'game.bat', soundboard, multiple, midi: true });
            for (let f = 0; f <= UNTIL; f++) {
                if (KEYS.has(f)) m.pressKey(NKEY[KEYS.get(f)]);
                m.runFrames(1);
            }
            m.M.ccall('np2kai_set_vol', null, ['number', 'number', 'number', 'number'], [0, 0, 0, 0]);
            const pcm = m.captureAudio(8);
            let ss = 0; for (const v of pcm) ss += v * v;
            const rms = Math.round(Math.sqrt(ss / pcm.length));
            console.log(JSON.stringify({ soundboard, multiple, midiRms: rms, midiAudible: rms > 1300,
                wasm: m.info().wasm.sha256.slice(0, 16) }));
        }
    }
    fs.rmSync(TMP, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
