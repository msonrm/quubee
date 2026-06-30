// PMD (.M) 曲データの memo (曲名/作曲/コメント) パーサ。
//
// KAJA の PMD で .M をコンパイルすると、曲データ末尾に作者注釈 (#Title/#Composer/
// #Arrangement/#Memo に由来する文字列) が「memo ブロック」として埋め込まれる。
// これを取り出して「ファイルをタップ→曲名/作曲者/作者コメントを表示」に使う。
//
// フォーマット (東方旧作 BGM の実コーパス 45 本で全数検証, 2026-06-16):
//   - ファイル末尾 2 byte = 0x00 0x00 (インデックス表の終端)
//   - その手前に 2 byte LE のエントリが「EOF へ向かって昇順」で並ぶ (= index 表)
//   - 各エントリは「直前文字列を終端する NUL (0x00)」または「空スロット印 (0xFF)」を指す
//   - 自己参照的: nulAfter(E[i]+1) === E[i+1] (E[i] の文字列の終端 NUL が次エントリ)
//   - 文字列本体は E[i]+1 から次 NUL まで (Shift_JIS)
//   - MC バージョンで予約スロット数が変わる (PMDDATA.DOC AH=1Dh 準拠):
//       MC < v4.2a  : 1 予約 (PCMFile のみ)       → [1]=曲名
//       MC v4.2a-v4.7x: 2 予約 (PPSFile+PCMFile)  → [2]=曲名
//       MC v4.8a+   : 3 予約 (PPZFile+PPSFile+PCMFile) → [3]=曲名
//     titleOffset は ent[0] が 0xFF (PPZFile 空) かヘッダサイズで検出
//   - 正準スロット (以降): [titleOffset]=曲名、+1=作曲、+2=編曲、+3..=コメント行
//
// 後方走査で楽曲データの 1 ワードを過剰に拾うことがあるが、(a) 区切りバイト判定と
// (b) 自己参照チェーン整合トリムの 2 段で偽エントリを落とす (推測でなく構造で確定)。
//
// 回帰: tools/pmd_meta_test.js (ローカルコーパス展開→45/45 で曲名/作曲を抽出)。
(function (root) {
    'use strict';

    function nulAfter(data, s) {
        const i = data.indexOf(0, s);
        return i >= 0 ? i : data.length;
    }

    function allFF(u) {
        for (let i = 0; i < u.length; i++) if (u[i] !== 0xff) return false;
        return u.length > 0;
    }

    // bytes (Uint8Array | ArrayBuffer) → { title, composer, arranger, memo:[...] } | null。
    // decodeFn(Uint8Array)->string を渡すと SJIS 復号に使う (省略時は TextDecoder('shift_jis'))。
    // 既定デコーダはブラウザ/Node とも利用可。bridge.js は NEC 罫線対応の decodeSjisText を渡す。
    function parseMemo(bytes, decodeFn) {
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const n = data.length;
        if (n < 6 || data[n - 1] !== 0 || data[n - 2] !== 0) return null;

        // 末尾の index 表エントリを後方収集: 区切りバイト (0x00/0xFF) を指し、昇順を保つものだけ。
        const cand = [];
        let prev = n;
        for (let p = n - 4; p >= 0; p -= 2) {
            const w = data[p] | (data[p + 1] << 8);
            if (w > 0 && w < n && w <= prev && (data[w] === 0x00 || data[w] === 0xff)) {
                cand.push(w); prev = w;
            } else break;
        }
        if (cand.length < 2) return null;
        cand.reverse();   // 昇順 (ファイル先頭→末尾)

        // 自己参照チェーンが成立する最長サフィックスへ刈り込む (先頭の偽エントリを除去)。
        let start = cand.length - 1;
        for (let i = 0; i < cand.length - 1; i++) {
            if (nulAfter(data, cand[i] + 1) === cand[i + 1]) { start = i; break; }
        }
        while (start > 0 && nulAfter(data, cand[start - 1] + 1) === cand[start]) start--;
        const ent = cand.slice(start);

        // .M ヘッダ先頭 2 バイト LE = パートオフセット表サイズ (PMD86=0x1A, PMDPPZ>=0x2A)。
        // ent[0] が 0xFF なら PPZFile 空スロット (MC v4.8a+) → 3 予約スロット。
        // それ以外はヘッダサイズで判定。
        const headerSize = data[0] | (data[1] << 8);
        let titleOffset;
        if (data[ent[0]] === 0xFF) {
            titleOffset = 3;
        } else if (headerSize >= 0x2A) {
            titleOffset = 3;
        } else if (headerSize >= 0x1A) {
            titleOffset = 2;
        } else {
            titleOffset = 1;
        }
        if (ent.length <= titleOffset) return null;

        const td = (typeof TextDecoder !== 'undefined') ? new TextDecoder('shift_jis') : null;
        const decode1 = (e) => {
            if (e === undefined) return '';
            const u = data.subarray(e + 1, nulAfter(data, e + 1));
            if (u.length === 0 || allFF(u)) return '';
            if (decodeFn) return decodeFn(u);
            return td ? td.decode(u) : '';
        };

        return {
            title:    decode1(ent[titleOffset]),
            composer: decode1(ent[titleOffset + 1]),
            arranger: decode1(ent[titleOffset + 2]),
            memo:     ent.slice(titleOffset + 3).map(decode1).filter((s) => s.trim().length > 0),
        };
    }

    const api = { parseMemo };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.QBPmd = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
