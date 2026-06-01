#!/usr/bin/env python3
"""
boot.bin (1024バイト) を PC-98 2HD d88 ディスクイメージに埋め込む。
cylinder0, head0, sector1 (boot sector) に書き込む。
"""
import struct, sys

def make_d88(boot_bin_path, output_path):
    with open(boot_bin_path, 'rb') as f:
        boot_code = f.read()
    assert len(boot_code) == 1024, f"boot.bin must be 1024 bytes, got {len(boot_code)}"

    # 2HD: 80 cylinders x 2 heads x 8 sectors x 1024 bytes = 1,310,720 bytes
    CYLINDERS    = 80
    HEADS        = 2
    SECTORS      = 8
    SECTOR_SIZE  = 1024   # N=3
    N_CODE       = 3

    # d88 header
    disk_name = b'QUUBEE BOOT\x00\x00\x00\x00\x00\x00'  # 17 bytes
    reserved  = b'\x00' * 9
    wp        = b'\x00'
    disk_type = b'\x20'  # 2HD

    num_tracks = CYLINDERS * HEADS  # 160

    header_size = 17 + 9 + 1 + 1 + 4 + num_tracks * 4  # = 688 bytes

    # Build sectors first to calculate offsets
    # 各セクタレコード = 16バイトヘッダ + データ
    sector_record_size = 16 + SECTOR_SIZE  # 1040 bytes

    # track offset table
    track_offsets = []
    current_offset = header_size
    for track in range(num_tracks):
        track_offsets.append(current_offset)
        current_offset += SECTORS * sector_record_size

    disk_size = current_offset

    # build header bytes
    header = disk_name + reserved + wp + disk_type
    header += struct.pack('<I', disk_size)
    for off in track_offsets:
        header += struct.pack('<I', off)
    assert len(header) == header_size

    # build track/sector data
    body = bytearray()
    for cyl in range(CYLINDERS):
        for head in range(HEADS):
            for sec in range(1, SECTORS + 1):
                # セクタヘッダ (16バイト)
                c = cyl
                h = head
                r = sec
                n = N_CODE
                num_sec_in_track = SECTORS
                density = 0x00   # double density
                del_mark = 0x00
                status   = 0x00
                reserved_sec = b'\x00' * 5
                data_size = SECTOR_SIZE

                sec_hdr = struct.pack('<BBBBHBB', c, h, r, n, num_sec_in_track, density, del_mark)
                sec_hdr += bytes([status]) + reserved_sec
                sec_hdr += struct.pack('<H', data_size)
                assert len(sec_hdr) == 16

                # セクタデータ
                if cyl == 0 and head == 0 and sec == 1:
                    sec_data = boot_code          # ブートセクタ
                else:
                    sec_data = bytes(SECTOR_SIZE) # 空

                body += sec_hdr + sec_data

    with open(output_path, 'wb') as f:
        f.write(header)
        f.write(body)

    print(f"Written: {output_path} ({len(header) + len(body)} bytes)")

if __name__ == '__main__':
    make_d88(
        sys.argv[1] if len(sys.argv) > 1 else 'boot.bin',
        sys.argv[2] if len(sys.argv) > 2 else 'np2kai_boot.d88',
    )
