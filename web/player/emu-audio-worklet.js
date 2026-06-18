// QuuBee 音声出力 AudioWorklet processor (Stage 1c〜)。
//
// 役割: SharedArrayBuffer のリングバッファ (worker = emulator が producer) を読んでスピーカへ出すだけの
// 純 consumer。音声スレッド (audio render thread) で走るのでメインスレッドのジャンクと完全に無縁になり、
// 「フレームが詰まる音のスキップ」が原理的に消える。テンポの揺れは worker 側で emulation を一定ペースで
// 先回り供給することで消える (リングが両者のクロック差を吸収)。
//
// リング形式 (SPSC, lock-free):
//   sab = Int32Array[2] ヘッダ {writeIdx, readIdx} (フレーム単位の単調増加カウンタ) +
//         Float32 データ (L,R インターリーブ, ringFrames*2 要素)。
//   ringFrames は 2 の冪。idx & (ringFrames-1) で巻き戻し → int32 オーバーフロー (約12時間) も安全。
//   writeIdx - readIdx = 利用可能フレーム数 (2の補数の差なので wrap しても正しい)。

class EmuAudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const o = options.processorOptions || {};
        this.cap = o.ringFrames | 0;                 // 2 の冪
        this.mask = this.cap - 1;
        this.ctrl = new Int32Array(o.sab, 0, 2);      // [writeIdx, readIdx]
        this.data = new Float32Array(o.sab, 8, this.cap * 2);
        this.underruns = 0;
        this.port.onmessage = (e) => {
            if (e.data === 'stats') this.port.postMessage({ underruns: this.underruns });
        };
    }

    process(_inputs, outputs) {
        const out = outputs[0];
        const L = out[0];
        const R = out[1] || out[0];
        const n = L.length;                           // 通常 128
        const writeIdx = Atomics.load(this.ctrl, 0);  // producer の最新位置 (スナップショット)
        let readIdx = Atomics.load(this.ctrl, 1);
        for (let i = 0; i < n; i++) {
            if (readIdx !== writeIdx) {
                const idx = (readIdx & this.mask) * 2;
                L[i] = this.data[idx];
                R[i] = this.data[idx + 1];
                readIdx = (readIdx + 1) | 0;
            } else {
                L[i] = 0; R[i] = 0;                   // underrun → 無音 (riング枯れ。worker が供給不足)
                this.underruns++;
            }
        }
        Atomics.store(this.ctrl, 1, readIdx);         // 読み終えた位置を publish
        return true;                                  // 常駐
    }
}

registerProcessor('emu-audio', EmuAudioProcessor);
