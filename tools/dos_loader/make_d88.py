#!/usr/bin/env python3
"""
boot.bin (1024 byte) を PC-98 2HD .d88 のブートセクタに埋め込む。
tools/boot_hello/make_d88.py と同一処理。Phase 3 ローダ専用に切り出し。
"""
import sys
sys.path.insert(0, '..')
sys.path.insert(0, '../boot_hello')
from make_d88 import make_d88  # noqa: E402

if __name__ == '__main__':
    make_d88(
        sys.argv[1] if len(sys.argv) > 1 else 'boot.bin',
        sys.argv[2] if len(sys.argv) > 2 else 'loader.d88',
    )
