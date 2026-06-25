#!/bin/bash
# build_pmd.sh — KAJA の PMD ソース(2019 自由公開)からクリーン素性の PMD86.COM + PMP.COM を生成。
#
# QuuBee は「素の .M 単体ドロップ→即演奏」のために PMD ドライバ/プレイヤを内蔵する。1997 配布
# バイナリは「無断の改変・営利使用を禁ず」だが、KAJA(梶原正裕)氏は 2019/12/25 に PMD/MC/PMP の
# 全ソースを「著作権は放棄しないが、ご自由に使って構いません。再利用歓迎」で公開した。本スクリプトは
# その自由公開ソースから我々自身でバイナリをビルドする(=クリーンな素性)。CREDITS に KAJA 氏を明記。
#
# 出力: tools/pmd_build/out/{PMD86.COM,PMP.COM}
#
# 前提: gh(認証済), gcc, make, tar。git clone はサンドボックスの DNS で不可なので gh api の tarball を使う。
# 参考: docs は tools/pmd_build/README.md。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d /tmp/pmd_build.XXXXXX)"
OUT="$HERE/out"
mkdir -p "$OUT"
UASM_REPO="Terraspace/UASM"            # MASM 互換アセンブラ(JWasm フォーク)
PMD_REPO="d2lmirrors/pmd"              # KAJA 2019 公開ソースのミラー
# 再現性のためソースを commit に pin する (master は moving target)。これにより誰でも同じバイナリを
# 再ビルドし、同梱物 (web/assets/pmd/) のハッシュと照合できる。期待ハッシュは README.md「再現性」節。
# 更新時は両 SHA を上げ、再ビルドして web/assets/pmd/ と README のハッシュも併せて更新すること。
UASM_REF="bffb18461dd541479064990c3b2750ab50ae23e2"
PMD_REF="c620dc95c5e47970e7839cb5f0b7b9ab742d4f46"

echo "==== 1. UASM(MASM 互換アセンブラ)をビルド ===="
# 【重要】UASM は環境変数 UASM を「既定オプション」として読む (MASM の ML 環境変数と同じ)。
# アセンブラのパスを変数 UASM のまま渡すと、uasm が自分自身のパスを追加ソースと解釈して
# ELF バイナリを assemble しようとし大量のエラーを出す。変数名は ASM を使い、UASM env は unset する。
ASM="${UASM:-}"
unset UASM 2>/dev/null || true
if [ -z "$ASM" ] || [ ! -x "$ASM" ]; then
    gh api "repos/$UASM_REPO/tarball/$UASM_REF" > "$WORK/uasm.tar.gz"
    mkdir -p "$WORK/uasm" && tar xzf "$WORK/uasm.tar.gz" -C "$WORK/uasm" --strip-components=1
    cd "$WORK/uasm"
    # modern gcc-14 対応の最小パッチ(Windows 専用ヘッダ / MSVC グローバル / 厳格化):
    : > H/direct.h
    printf '%s\n' '#ifndef UASM_DIRECT_H_SHIM' '#define UASM_DIRECT_H_SHIM' \
        '#include <unistd.h>' '#ifndef _MAX_PATH' '#define _MAX_PATH 4096' '#endif' \
        '#define _getcwd getcwd' '#define _chdir chdir' '#endif' > H/direct.h
    grep -q '_pgmptr = ' dbgcv.c || sed -i '1i char *_pgmptr = "";' dbgcv.c
    sed -i 's/(unsigned short)(s - cv.ps - 2)/(unsigned short)((char*)s - (char*)cv.ps - 2)/' dbgcv.c
    sed -i 's/cv.section->length += (s - start)/cv.section->length += ((char*)s - (char*)start)/' dbgcv.c
    make -f Makefile_Linux CC=gcc \
        extra_c_flags="-DNDEBUG -O2 -funsigned-char -w -fcommon -Wno-error=implicit-function-declaration -Wno-error=implicit-int -Wno-error=incompatible-pointer-types -Wno-error=int-conversion" \
        -j"$(nproc)"
    ASM="$WORK/uasm/GccUnixR/uasm"
fi

echo "==== 2. KAJA 2019 ソースを取得 ===="
gh api "repos/$PMD_REPO/tarball/$PMD_REF" > "$WORK/pmd.tar.gz"
mkdir -p "$WORK/src" && tar xzf "$WORK/pmd.tar.gz" -C "$WORK/src" --strip-components=1
cd "$WORK/src"

echo "==== 3. OPTASM→UASM 移植変換(駆動に必要な最小限) ===="
# 変換は KAJA ソースを別アセンブラ(UASM)に通すための機械的補正のみ。ロジックは不変。
for d in pmd pmp; do
    for f in "$d"/*.ASM "$d"/*.INC; do
        [ -f "$f" ] || continue
        tr -d '\032\034' < "$f" > "$f.t" && mv "$f.t" "$f"          # (a) DOS EOF 等の制御文字除去
        sed -E -i 's/-([0-9]+)\[([A-Za-z]+)\]/[\2-\1]/g' "$f"        # (b) 負変位 -N[reg]→[reg-N]
    done
done
# (c) 文字列 equate をテキスト equate <...> に(UASM は数値化して "magnitude too large")
sed -E -i 's/^(ver[[:space:]]+equ[[:space:]]+)"4\.8s"/\1<"4.8s">/' pmd/PMD.ASM
sed -E -i 's/^(_myname[[:space:]]+equ[[:space:]]+)"PMD86   COM"/\1<"PMD86   COM">/' pmd/PMD86.ASM
sed -E -i 's/^(resmes[[:space:]]+equ[[:space:]]+)"PMD86 ver\.",ver/\1<"PMD86 ver.",ver>/' pmd/PMD86.ASM
sed -E -i 's/^(_optnam[[:space:]]+equ[[:space:]]+)"\(86PCM\)"/\1<"(86PCM)">/' pmd/PMD86.ASM
# (d) loop din0 が別アセンブラの僅かなコード長差で短ジャンプ範囲外 → dec cx/jnz
perl -0pi -e 's/\tloop\tdin0/\tdec\tcx\n\tjnz\tdin0/' pmd/PMD.ASM
# (e) include はファイル名の大小が混在(Linux は case-sensitive)→ 小文字コピーを併置
for d in pmd pmp; do for f in "$d"/*.ASM "$d"/*.INC; do b=$(basename "$f"); lb=$(echo "$b"|tr 'A-Z' 'a-z'); [ "$b" != "$lb" ] && cp -f "$f" "$d/$lb"; done; done

echo "==== 4. アセンブル(uasm -bin -Zm = 原典の ml /Zm 相当の M510 互換)===="
( cd pmd && "$ASM" -bin -Zm -Fo=PMD86.COM PMD86.ASM >/dev/null )
( cd pmp && "$ASM" -bin -Zm -Fo=PMP.COM   PMP.ASM   >/dev/null )

echo "==== 5. PMP の末尾 BSS ゼロ埋めをトリム(-bin が未初期化バッファを出力するため)===="
python3 - "$WORK/src/pmp/PMP.COM" <<'PY'
import sys
p=sys.argv[1]; d=open(p,'rb').read()
z=0
for b in reversed(d):
    if b==0: z+=1
    else: break
open(p,'wb').write(d[:len(d)-z])
PY

cp -f "$WORK/src/pmd/PMD86.COM" "$OUT/PMD86.COM"
cp -f "$WORK/src/pmp/PMP.COM"   "$OUT/PMP.COM"
echo "==== 完了 ===="
ls -la "$OUT"/PMD86.COM "$OUT"/PMP.COM
echo "OK: $OUT/{PMD86.COM,PMP.COM} (KAJA 2019 ソース由来・クリーン素性)"
rm -rf "$WORK"
