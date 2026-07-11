// tier.js — headless 観察の分類 (PC 状態 + 画面 tier)。bio100_triage.js の分類を共有化したもの。
//
// PC 状態 (dos_loader.h のトランポリン番地、linear):
//   EXIT : 0xFEE30 = QB_TRAMP_HALT_LOOP (プログラム正常終了後の停止 HLT)
//   WAIT : 0xFEE00-0xFEE7F の他トランポリン (INT21 等で DOS コール内ブロック = 入力待ち・生存)
//   BIOS : 上記以外の 0xE8000-0xFFFFF (neccheck 近傍) = 本物の BIOS 暴走
//   USER : ユーザーコード実行中
// 注意: BIOS 分類は偽陰性がありうる (GETS は triage で BIOS 判定だったがブラウザ実機で動作、
// 2026-07-11)。「CRASH = 要ブラウザ確認の候補」であって死刑判決ではない。
//
// tier (画面メトリクス優先、乏しければ PC 状態で割る):
//   ALIVE  : 多色 graphics + フレーム間変化 (ほぼ確実にゲームが回っている)
//   RENDER : 多色 graphics 静止 (タイトル/ゲーム画面到達の強い兆候)
//   BOOT   : graphics 乏しい (色 4-6)
//   WAIT   : 色乏しいが DOS 入力待ちで生存 (テキストゲーム等)
//   EXIT   : 色乏しく正常終了
//   CRASH  : 色乏しく BIOS 暴走域 (上の注意を参照)
//   BUSY   : 色乏しくユーザーコード実行中 (busy loop / 描画前)

const TRAMP_HALT = 0xFEE30;
const TRAMP_LO = 0xFEE00, TRAMP_HI = 0xFEE7F;
const BIOS_LO = 0xE8000, BIOS_HI = 0xFFFFF;

function classifyPc(pc, exited) {
    if (exited || pc === TRAMP_HALT) return 'EXIT';
    if (pc >= TRAMP_LO && pc <= TRAMP_HI) return 'WAIT';
    if (pc >= BIOS_LO && pc <= BIOS_HI) return 'BIOS';
    return 'USER';
}

function classifyTier(state, maxColors, animated) {
    if (maxColors > 6) return animated ? 'ALIVE' : 'RENDER';
    if (maxColors >= 4) return 'BOOT';
    if (state === 'WAIT') return 'WAIT';
    if (state === 'EXIT') return 'EXIT';
    if (state === 'BIOS') return 'CRASH';
    return 'BUSY';
}

/* フレームバッファの色数 + 粗ハッシュ (17 画素おきサンプル。triage と同一のメトリクス) */
function fbMetrics(M, ptr, w, h) {
    if (!ptr || w <= 0 || h <= 0) return { colors: 0, hash: 0 };
    const base = ptr >> 1, n = w * h, set = new Set();
    let hash = 0;
    for (let i = 0; i < n; i += 17) {
        const px = M.HEAPU16[base + i];
        set.add(px);
        hash = (hash + px * (i + 1)) >>> 0;
    }
    return { colors: set.size, hash };
}

module.exports = { TRAMP_HALT, TRAMP_LO, TRAMP_HI, BIOS_LO, BIOS_HI, classifyPc, classifyTier, fbMetrics };
