/*
 * QB プレイヤー AudioWorklet
 *
 * メインスレッドから postMessage で Int16 ステレオインターリーブの PCM を受け
 * 取り、内部リングに貯めて process() で 128 frame ずつ出力する。
 *
 * リングを大きめ (~680ms) にしてメインスレッドのジャンク (run_frame の遅延等)
 * を吸収し、ScriptProcessorNode 比で micro-underrun を減らす狙い。
 */
const CAP = 32768;   /* ステレオフレーム数。48kHz で ~680ms */

class QbPlayer extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufL = new Float32Array(CAP);
        this.bufR = new Float32Array(CAP);
        this.w = 0;
        this.r = 0;
        this.port.onmessage = (e) => {
            const pcm = e.data;  /* Int16Array, ステレオインターリーブ */
            const n = pcm.length >> 1;
            if (n <= 0) return;
            /* オーバーフロー時は古い側を捨てて新しい側を優先 (qb_soundmng と同じ方針) */
            let used = (this.w - this.r + CAP) % CAP;
            if (used + n > CAP - 1) {
                const drop = used + n - (CAP - 1);
                this.r = (this.r + drop) % CAP;
            }
            let w = this.w;
            for (let i = 0; i < n; i++) {
                this.bufL[w] = pcm[i*2  ] / 32768;
                this.bufR[w] = pcm[i*2+1] / 32768;
                w = (w + 1) % CAP;
            }
            this.w = w;
        };
    }

    process(_inputs, outputs) {
        const L = outputs[0][0];
        const R = outputs[0][1];
        const n = L.length;  /* 通常 128 */
        const used = (this.w - this.r + CAP) % CAP;
        const take = used < n ? used : n;
        let r = this.r;
        for (let i = 0; i < take; i++) {
            L[i] = this.bufL[r];
            R[i] = this.bufR[r];
            r = (r + 1) % CAP;
        }
        /* underrun 分は無音 */
        for (let i = take; i < n; i++) { L[i] = 0; R[i] = 0; }
        this.r = r;
        return true;
    }
}

registerProcessor('qb-player', QbPlayer);
