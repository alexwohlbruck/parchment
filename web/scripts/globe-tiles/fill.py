"""Gzip the vector tiles, and give every tile position a file.

Static hosts answer a missing file with the app's index.html, which neither a
vector nor a raster tile can parse, so the empty ones are written too.
"""
import gzip
import io
import sys
from pathlib import Path

from PIL import Image

OUT = Path(sys.argv[1])
MAXZOOM = int(sys.argv[2])
RELIEF_MAXZOOM = int(sys.argv[3])


def positions(maxzoom: int):
    for z in range(maxzoom + 1):
        for x in range(2 ** z):
            for y in range(2 ** z):
                yield z, x, y


def vector():
    for z, x, y in positions(MAXZOOM):
        tile = OUT / 'vector' / str(z) / str(x) / f'{y}.pbf'
        data = tile.read_bytes() if tile.exists() else b''
        tile.unlink(missing_ok=True)
        target = tile.with_suffix('.pbf.gz')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(gzip.compress(data, 9, mtime=0))


def relief():
    blank = io.BytesIO()
    Image.new('RGBA', (1, 1), (0, 0, 0, 0)).save(blank, 'WEBP', lossless=True)
    for z, x, y in positions(RELIEF_MAXZOOM):
        tile = OUT / 'relief' / str(z) / str(x) / f'{y}.webp'
        if not tile.exists():
            tile.parent.mkdir(parents=True, exist_ok=True)
            tile.write_bytes(blank.getvalue())


vector()
relief()
