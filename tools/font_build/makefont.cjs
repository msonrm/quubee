// Generates a font image for NP2.
// The conversion logic is mostly taken from src/font/fontmake.c.

let fs = require('fs');
let BDF = require('bdf');

class FontBitmap {
    constructor(base_image) {
        if (base_image) {
            const contents = fs.readFileSync(base_image);
            const infoHeader = new DataView(contents.buffer, contents.byteOffset + 14, 40);
            this.width = infoHeader.getUint32(4, true);
            this.height = infoHeader.getUint32(8, true);
            const dataOffset = 62;
            const dataSize = this.width * this.height / 8;
            if (contents.length < dataOffset + dataSize) {
                throw new Error('BMP file is smaller than expected.');
            }
            const dataView = new Uint8Array(contents.buffer, contents.byteOffset + dataOffset, dataSize);
            this.buf = new Uint8Array(dataView);
        } else {
            this.width = 2048;
            this.height = 2048;
            this.buf = new Uint8Array(this.width * this.height / 8);
            this.buf.fill(0xff);
        }
    }

    put(x, y, byte) {
        this.buf[(this.height - 1 - y) * (this.width / 8) + (x / 8)] = byte ^ 0xff;
    }

    writeToFile(fname) {
        let buf = new ArrayBuffer(62);
        let fileHeader = new DataView(buf, 0, 14);
        let infoHeader = new DataView(buf, 14, 40);
        let palette = new DataView(buf, 54, 8);
        fileHeader.setUint16(0, 0x424d, false); // 'BM'
        fileHeader.setUint32(2, buf.byteLength + this.buf.byteLength, true); // bfSize
        fileHeader.setUint32(10, buf.byteLength, true);  // bfOffBits
        infoHeader.setUint32(0, infoHeader.byteLength, true); // biSize
        infoHeader.setUint32(4, this.width, true); // biWidth
        infoHeader.setUint32(8, this.height, true); // biHeight
        infoHeader.setUint16(12, 1, true); // biPlanes
        infoHeader.setUint16(14, 1, true); // biBitCount
        infoHeader.setUint32(20, this.buf.byteLength, true); // biSizeImage
        infoHeader.setUint32(32, 2, true); // biClrUsed
        infoHeader.setUint32(36, 2, true); // biClrImportant
        palette.setUint32(4, 0xffffff, true);

        let stream = fs.createWriteStream(fname);
        stream.write(new Uint8Array(buf));
        stream.write(new Uint8Array(this.buf.buffer));
        stream.end();
    }
}

function setank(bmp, bdf, from, to) {
    for (let c = from; c <= to; c++) {
        let glyph = bdf.cmap[c];
        for (let y = 0; y < 16; y++) {
            bmp.put(glyph.code * 8, y, glyph.bytes[y]);
        }
    }
}

function setjis(bmp, font) {
    for (let h = 0x2100; h < 0x8000; h += 0x100) {
        for (let l = 0x21; l < 0x7f; l++) {
            let jis = h + l;
            let x = (h / 0x100 - 0x20) * 16;
            if (!ispc98jis(jis))
                continue;
            jis = cnvjis(jis, jis78_83);
            jis = cnvjis(jis, jis83_90);
            let glyph = font.cmap[jis];
            if (!glyph)
                continue;
            for (let y = 0; y < 16; y++) {
                bmp.put(x, l * 16 + y, glyph.bytes[y * 2]);
                bmp.put(x + 8, l * 16 + y, glyph.bytes[y * 2 + 1]);
            }
        }
    }
}

const jis78_83 = [
    [0x3646, 0x7421], /* 尭:堯 */[0x4b6a, 0x7422], /* 槙:槇 */
    [0x4d5a, 0x7423], /* 遥:遙 */[0x596a, 0x7424], /* 搖:瑤 */];

const jis83_90 = [
    [0x724d, 0x3033], /* 鰺:鯵 */[0x7274, 0x3229], /* 鶯:鴬 */
    [0x695a, 0x3342], /* 蠣:蛎 */[0x5978, 0x3349], /* 攪:撹 */
    [0x635e, 0x3376], /* 竈:竃 */[0x5e75, 0x3443], /* 灌:潅 */
    [0x6b5d, 0x3452], /* 諫:諌 */[0x7074, 0x375b], /* 頸:頚 */
    [0x6268, 0x395c], /* 礦:砿 */[0x6922, 0x3c49], /* 蘂:蕊 */
    [0x7057, 0x3f59], /* 靱:靭 */[0x6c4d, 0x4128], /* 賤:賎 */
    [0x5464, 0x445b], /* 壺:壷 */[0x626a, 0x4557], /* 礪:砺 */
    [0x5b6d, 0x456e], /* 檮:梼 */[0x5e39, 0x4573], /* 濤:涛 */
    [0x6d6e, 0x4676], /* 邇:迩 */[0x6a24, 0x4768], /* 蠅:蝿 */
    [0x5b58, 0x4930], /* 檜:桧 */[0x5056, 0x4b79], /* 儘:侭 */
    [0x692e, 0x4c79], /* 藪:薮 */[0x6446, 0x4f36], /* 籠:篭 */];

function cnvjis(jis, table) {
    for (let pair of table) {
        if (jis == pair[0])
            return pair[1];
        if (jis == pair[1])
            return pair[0];
    }
    return jis;
}

function ispc98jis(jis) {
    const deltable = [
        [[0x0f, 0x5f]],
        [[0x01, 0x10], [0x1a, 0x21], [0x3b, 0x41], [0x5b, 0x5f]],
        [[0x54, 0x5f]],
        [[0x57, 0x5f]],
        [[0x19, 0x21], [0x39, 0x5f]],
        [[0x22, 0x31], [0x52, 0x5f]],
        [[0x01, 0x5f]],
        [[0x01, 0x5f]],
        [[0x01, 0x5f]],
        [[0x01, 0x5f]],
        [[0x01, 0x5f]],
        [[0x1f, 0x20], [0x37, 0x3f], [0x5d, 0x5f]]];

    let tmp = jis & 0xff;
    switch (jis >> 8) {
        case 0x22:
        case 0x23:
        case 0x24:
        case 0x25:
        case 0x26:
        case 0x27:
        case 0x28:
        case 0x29:
        case 0x2a:
        case 0x2b:
        case 0x2c:
        case 0x2d:
            tmp -= 0x20;
            for (let range of deltable[(jis >> 8) - 0x22]) {
                if (tmp >= range[0] && tmp < range[1])
                    return false;
            }
            break;
        case 0x4f:
            if (tmp >= 0x54)
                return false;
            break;
        case 0x7c:
            if (tmp == 0x6f || tmp == 0x70)
                return false;
            break;
        case 0x2e:
        case 0x2f:
        case 0x74:
        case 0x75:
        case 0x76:
        case 0x77:
        case 0x78:
        case 0x7d:
        case 0x7e:
        case 0x7f:
            return false;
    }
    return true;
}

function loadBDF(fname) {
    let font = new BDF();
    font.loadSync(fname);
    font.cmap = {};
    for (let name in font.glyphs) {
        let glyph = font.glyphs[name];
        font.cmap[glyph.code] = glyph;
    }
    return font;
}

function makepc98bmp(fname) {
    let shinonome_a = loadBDF('shnm8x16a.bdf');
    let shinonome_r = loadBDF('shnm8x16r.bdf');
    let shinonome = loadBDF('shnmk16.bdf');

    let bmp = new FontBitmap('base/base.bmp');
    // ASCII
    //setank(bmp, shinonome_a, 0x20, 0x7e);
    // 0x5c is YEN SIGN
    //setank(bmp, shinonome_r, 0x5c, 0x5c);
    // 1-byte Kana
    //setank(bmp, shinonome_r, 0xa1, 0xdf);

    // JIS
    setjis(bmp, shinonome);

    bmp.writeToFile(fname);
}

makepc98bmp('font.bmp')
