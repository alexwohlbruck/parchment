"""Bake a soft, multi-directional hillshade into translucent raster tiles from Mapterhorn elevation."""
import io
import math
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')
CACHE = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('.')
MAXZOOM = int(sys.argv[3]) if len(sys.argv) > 3 else 4
TILE = 512
# Tiles are stored at half the grid's resolution and stretched: relief this soft loses nothing, and weighs a quarter.
TILE_OUT = 256
# Elevation blur, in source pixels, before shading.
SMOOTHING = 1.5
SOURCE = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'
# Light from the north-west, softened by three neighbours, the way atlas relief is drawn.
LIGHTS = [(315, 0.5), (270, 0.2), (0, 0.2), (225, 0.1)]
ALTITUDE = 45
# Relief is exaggerated more than life at globe scale, or only the Himalaya would read.
EXAGGERATION = 8
SHADOW_ALPHA = 150
HIGHLIGHT_ALPHA = 110
QUALITY = 60


def fetch(z: int, x: int, y: int) -> np.ndarray:
    path = CACHE / f'{z}-{x}-{y}.webp'
    if not path.exists():
        request = urllib.request.Request(SOURCE.format(z=z, x=x, y=y), headers={'User-Agent': 'globe-tiles/1.0'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                path.write_bytes(response.read())
        except urllib.error.HTTPError as error:
            # Open ocean has no tile.
            if error.code != 404:
                raise
            path.write_bytes(b'')
    if not path.stat().st_size:
        return np.zeros((TILE, TILE), np.float32)
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def mosaic(z: int) -> np.ndarray:
    n = 2 ** z
    tiles = {}
    with ThreadPoolExecutor(16) as pool:
        for (x, y), dem in zip([(x, y) for y in range(n) for x in range(n)], pool.map(lambda t: fetch(z, *t), [(x, y) for y in range(n) for x in range(n)])):
            tiles[x, y] = dem
    return np.block([[tiles[x, y] for x in range(n)] for y in range(n)])


def hillshade(dem: np.ndarray) -> np.ndarray:
    """Shade relative to flat ground, -1 (full shadow) to 1 (full light)."""
    size = dem.shape[0]
    rows = (np.arange(size) + 0.5) / size
    latitude = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * rows))))
    metres = (2 * math.pi * 6378137 / size) * np.cos(np.radians(latitude))[:, None]
    dem = ndimage.gaussian_filter(np.maximum(dem, 0), SMOOTHING)
    dy, dx = np.gradient(dem)
    slope_x = dx / metres * EXAGGERATION
    slope_y = dy / metres * EXAGGERATION
    slope = np.arctan(np.hypot(slope_x, slope_y))
    aspect = np.arctan2(-slope_x, slope_y)
    altitude = math.radians(ALTITUDE)
    flat = math.sin(altitude)
    shade = np.zeros_like(dem)
    for azimuth, weight in LIGHTS:
        direction = math.radians(360 - azimuth + 90)
        lit = np.sin(altitude) * np.cos(slope) + np.cos(altitude) * np.sin(slope) * np.cos(direction - aspect)
        shade += weight * (np.clip(lit, 0, 1) - flat)
    return np.clip(shade / flat, -1, 1)


def encode(shade: np.ndarray) -> bytes | None:
    """Shadow as translucent black, light as translucent white; None when the tile is flat."""
    shadow = np.clip(-shade, 0, 1) ** 0.8 * SHADOW_ALPHA
    light = np.clip(shade, 0, 1) ** 0.8 * HIGHLIGHT_ALPHA
    alpha = np.maximum(shadow, light)
    if alpha.max() < 4:
        return None
    # A smooth grey ramp rather than a black/white switch, which would defeat the encoder.
    grey = np.clip(128 + shade * 600, 0, 255)
    rgba = np.dstack([grey, grey, grey, alpha]).astype(np.uint8)
    out = io.BytesIO()
    Image.fromarray(rgba, 'RGBA').save(out, 'WEBP', quality=QUALITY, alpha_quality=QUALITY, method=6)
    return out.getvalue()


def halve(image: np.ndarray) -> np.ndarray:
    return image.reshape(image.shape[0] // 2, 2, image.shape[1] // 2, 2).mean(axis=(1, 3))


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    shade = halve(hillshade(mosaic(MAXZOOM)))
    written = total = 0
    for z in range(MAXZOOM, -1, -1):
        n = 2 ** z
        for y in range(n):
            for x in range(n):
                data = encode(shade[y * TILE_OUT:(y + 1) * TILE_OUT, x * TILE_OUT:(x + 1) * TILE_OUT])
                if data:
                    path = OUT / str(z) / str(x) / f'{y}.webp'
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                    written += 1
                    total += len(data)
        shade = halve(shade)
        print(f'z{z}: done', flush=True)
    print(f'{written} tiles, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
