// PMD (.M) 曲データの memo (曲名/作曲/編曲/コメント) パーサ。
//
// KAJA の PMD で .M をコンパイルすると、曲データ中に作者注釈 (#Title/#Composer/
// #Arranger/#Memo・#PCMFile 等) が「memo」として埋め込まれる。これを取り出して
// 「ファイルをタップ→曲名/作曲者/作者コメントを表示」に使う。
//
// **正典 (KAJA PMD ソース) の方法をそのまま移植**:
//   PMP.COM 自身は memo を解析せず、常駐ドライバの INT 60h AH=1Dh (get_memo) を
//   「メモ番号 1=Title / 2=Composer / 3=Arranger / 4..=Memo (先頭 '/' で終端)」と
//   固定で呼ぶだけ (PMP.ASM memo_put)。実体の get_memo (PMD.ASM) は内容を一切見ず
//   **.M ヘッダの MC バージョンから titleOffset を決定論的に決める**:
//     1. PMD データ先頭の part ポインタ表 word[0] == 0x001A (PMD86 形式)。.M は先頭に
//        0/1 バイトのプレフィックスがあり得るので base ∈ {0,1} を検出 (PMP がロードする
//        mmlbuf 位置に対応。東方コーパスは先頭に 0x00 が 1 個=base 1)。
//     2. P = word[base+0x18]。バージョン語 = word[base+P-2] (上位=0xFEh マーカ・下位=MC ver、
//        Ver4.0 のみ 00h でも可)。memo テーブル先頭 = base + word[base+P-4]。
//     3. メモ番号 N の取り出し: al=N; ver>=42h で +1 (#PPSFile 予約); ver>=48h で +1
//        (#PPZFile 予約); 無条件 +1。テーブルを al 個進めた word が文字列オフセット
//        (base 相対、0=未定義)。文字列は SJIS で NUL 終端。
//   メモ番号割り当て (正典 PMDDATA.DOC AH=1Dh): -2 #PPZFile / -1 #PPSFile / 0 #PCMFile・
//   #PPCFile / 1 #Title / 2 #Composer / 3 #Arranger / 4.. #Memo。= MC バージョンが
//   PPS/PPZ 予約スロットの有無を決め、それで Title の位置 (titleOffset 1/2/3) が動く。
//   内容を見ないので ASCII 曲名 (例 "OP.M") やファイル名形の曲名でも誤判定しない。
//
// 対応形式 = PMD86 (word==0x001A)。それ以外 (PMDPPZ 等で header 値が違う) は memo 取得不可
// として null を返す (driver も同様。誤ったメタを出すより安全)。
// 回帰: tools/pmd_meta_test.js (合成 .M で ver 0x40/0x42/0x48 + base 0/1 の分岐、東方コーパス 45/45)。
(function (root) {
    'use strict';

    function w16(data, o) {
        return (o >= 0 && o + 1 < data.length) ? (data[o] | (data[o + 1] << 8)) : -1;
    }

    // PMD86 .M データの開始位置 (base) を検出。part ポインタ表先頭 word == 0x001A。
    // .M は先頭に 0 か 1 バイトのプレフィックスがあり得る (排他: 同時に両方は成立しない)。
    function detectBase(data) {
        if (w16(data, 0) === 0x001A) return 0;
        if (w16(data, 1) === 0x001A) return 1;
        return -1;
    }

    // bytes (Uint8Array | ArrayBuffer) → { title, composer, arranger, memo:[...] } | null。
    // decodeFn(Uint8Array)->string を渡すと SJIS 復号に使う (省略時は TextDecoder('shift_jis'))。
    // bridge.js は NEC 罫線対応の decodeSjisText を渡す。
    function parseMemo(bytes, decodeFn) {
        const data = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);

        const base = detectBase(data);
        if (base < 0) return null;                 // PMD86 形式でない → driver 同様 memo 取得不可

        const P = w16(data, base + 0x18);
        if (P < 2) return null;
        const verWord = w16(data, base + P - 2);
        if (verWord < 0) return null;
        const bl = verWord & 0xFF, bh = (verWord >> 8) & 0xFF;
        // バージョン検証 (get_memo と同じ): Ver4.0(40h)は無条件 OK、以外は 0FEh マーカ必須 & bl>=41h。
        if (bl !== 0x40) {
            if (bh !== 0xFE) return null;
            if (bl < 0x41) return null;
        }
        const tableOff = w16(data, base + P - 4);
        if (tableOff < 0) return null;

        const td = (typeof TextDecoder !== 'undefined') ? new TextDecoder('shift_jis') : null;
        const decode1 = (u) => {
            if (u.length === 0) return '';
            if (decodeFn) return decodeFn(u);
            return td ? td.decode(u) : '';
        };

        // メモ番号 n (1=Title..) の文字列を get_memo と同じ手順で取り出す。
        function getMemo(n) {
            let al = n;
            if (bl >= 0x42) al++;                  // #PPSFile スロットあり
            if (bl >= 0x48) al++;                  // #PPZFile スロットあり
            al++;                                  // 無条件 inc
            let si = base + tableOff;
            let off = 0;
            for (let i = 0; i < al; i++) {
                off = w16(data, si);
                if (off <= 0) return '';           // 未定義 (entry==0 / 範囲外)
                si += 2;
            }
            const start = base + off;
            let end = data.indexOf(0, start);
            if (end < 0) end = data.length;
            if (start >= end) return '';
            return decode1(data.subarray(start, end));
        }

        const title = getMemo(1);
        if (!title) return null;                   // 曲名が取れなければ memo 無し扱い
        const composer = getMemo(2);
        const arranger = getMemo(3);
        const memo = [];
        for (let n = 4; n < 4 + 64; n++) {         // PMP: 未定義 or 先頭 '/' で終端 (安全弁 64 行)
            const s = getMemo(n);
            if (!s || s.charCodeAt(0) === 0x2F /* '/' */) break;
            memo.push(s);
        }
        return { title, composer, arranger, memo };
    }

    const api = { parseMemo };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.QBPmd = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
