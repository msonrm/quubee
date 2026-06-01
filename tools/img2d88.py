#!/usr/bin/env python3
"""PC-98 2HD raw .img → d88 変換ツール。
2HD: 77 cylinders x 2 heads x 8 sectors x 1024 bytes/sector"""
import struct, sys

CYLINDERS   = 77
HEADS       = 2
SECTORS     = 8
SECTOR_SIZE = 1024   # N=3
N_CODE      = 3
EXPECTED    = CYLINDERS * HEADS * SECTORS * SECTOR_SIZE  # 1,261,568

def convert(src, dst, name="FREEDOS98"):
    data = open(src, 'rb').read()
    if len(data) != EXPECTED:
        raise ValueError(f"Expected {EXPECTED} bytes, got {len(data)}")

    num_tracks   = CYLINDERS * HEADS
    header_size  = 17 + 9 + 1 + 1 + 4 + num_tracks * 4  # 688 bytes
    sector_rec   = 16 + SECTOR_SIZE                       # 1040 bytes
    track_size   = SECTORS * sector_rec

    disk_size = header_size + num_tracks * track_size

    # ---- header ----
    disk_name = name.encode()[:16].ljust(17, b'\x00')
    hdr  = disk_name
    hdr += b'\x00' * 9      # reserved
    hdr += b'\x00'          # write protect
    hdr += b'\x20'          # disk type: 2HD
    hdr += struct.pack('<I', disk_size)

    for t in range(num_tracks):
        hdr += struct.pack('<I', header_size + t * track_size)
    assert len(hdr) == header_size

    # ---- track/sector data ----
    body = bytearray()
    raw_offset = 0
    for cyl in range(CYLINDERS):
        for head in range(HEADS):
            for sec in range(1, SECTORS + 1):
                sec_hdr = struct.pack('<BBBBHBB',
                    cyl, head, sec, N_CODE,
                    SECTORS,   # num sectors in track
                    0x00,      # density: double
                    0x00)      # deleted mark
                sec_hdr += b'\x00'       # status
                sec_hdr += b'\x00' * 5  # reserved
                sec_hdr += struct.pack('<H', SECTOR_SIZE)
                assert len(sec_hdr) == 16

                body += sec_hdr + data[raw_offset: raw_offset + SECTOR_SIZE]
                raw_offset += SECTOR_SIZE

    with open(dst, 'wb') as f:
        f.write(hdr)
        f.write(body)
    print(f"Written: {dst} ({len(hdr)+len(body)} bytes)")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} input.img output.d88 [label]")
        sys.exit(1)
    name = sys.argv[3] if len(sys.argv) > 3 else "FREEDOS98"
    convert(sys.argv[1], sys.argv[2], name)
