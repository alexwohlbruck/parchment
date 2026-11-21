"""Turn the downloaded sources into line-delimited GeoJSON, one file per tile layer."""
import json
import sys
from pathlib import Path

import numpy as np
import pyogrio
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import measure
from shapely.geometry import LineString, mapping
from shapely.ops import polylabel

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

CLASSES = ['desert', 'scrub', 'grassland', 'savanna', 'tundra', 'dry_forest', 'forest', 'boreal', 'rainforest']
BIOMES = {
    1: 'rainforest', 14: 'rainforest',
    2: 'dry_forest', 3: 'dry_forest',
    4: 'forest', 5: 'forest',
    6: 'boreal',
    7: 'savanna',
    8: 'grassland', 9: 'grassland', 10: 'grassland',
    11: 'tundra',
    12: 'scrub',
    13: 'desert',
}
# Degrees: the raster grid, how far a biome reaches past its coast, and the blur that merges speckle.
GRID = 0.05
WIDTH, HEIGHT = int(360 / GRID), int(180 / GRID)
COAST_FRINGE = 0.3
SMOOTHING = 0.15
# Depth bands, in metres, and the smallest seamount or basin worth a ring.
DEPTHS = [200, 1000, 2000, 3000, 4000, 5000, 6000, 8000]
BATHYMETRY_MIN_AREA = 0.05
LANGUAGES = ['ar', 'bn', 'de', 'el', 'en', 'es', 'fr', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'sv', 'tr', 'vi', 'zh']


def shp(name: str) -> str:
    return str(next(SRC.rglob(f'{name}.shp')))


def write(layer: str, features):
    with open(OUT / f'{layer}.geojsonl', 'w') as f:
        for geometry, properties, minzoom in features:
            if geometry is None or geometry.is_empty:
                continue
            feature = {'type': 'Feature', 'geometry': mapping(geometry), 'properties': properties}
            if minzoom:
                feature['tippecanoe'] = {'minzoom': minzoom}
            f.write(json.dumps(feature, separators=(',', ':')) + '\n')


def rasterize_biomes() -> np.ndarray:
    """Each ecoregion's biome class index on a GRID-degree plate carrée grid, 0 where none."""
    _, _, geometry, fields = pyogrio.raw.read(shp('Ecoregions2017'), columns=['BIOME_NUM'])
    polygons = []
    for g, n in zip(shapely.from_wkb(geometry), fields[0]):
        c = BIOMES.get(int(n))
        if c:
            polygons += [(p.area, CLASSES.index(c) + 1, p) for p in getattr(g, 'geoms', [g])]
    image = Image.new('L', (WIDTH, HEIGHT), 0)
    draw = ImageDraw.Draw(image)
    # Largest first, so an ecoregion sitting in another's hole is drawn over it.
    for _, value, polygon in sorted(polygons, key=lambda p: -p[0]):
        xy = shapely.get_coordinates(polygon.exterior)
        draw.polygon([((x + 180) / GRID, (90 - y) / GRID) for x, y in xy], fill=value)
    return np.asarray(image)


def biomes():
    grid = rasterize_biomes()
    land = grid > 0
    # Reach each biome a little past its own coastline, under the basemap's.
    distance, (iy, ix) = ndimage.distance_transform_edt(~land, return_indices=True)
    fringe = distance * GRID < COAST_FRINGE
    grid = np.where(fringe, grid[iy, ix], 0)
    # Soft majority: blur each class's mask and keep the strongest, so speckle merges into its surroundings.
    best = np.zeros(grid.shape, np.float32)
    smooth = np.zeros(grid.shape, np.uint8)
    for value in range(1, len(CLASSES) + 1):
        weight = ndimage.gaussian_filter((grid == value).astype(np.float32), SMOOTHING / GRID)
        stronger = weight > best
        smooth[stronger] = value
        best[stronger] = weight[stronger]
    smooth[best < 0.5] = 0
    features = []
    for value, c in enumerate(CLASSES, 1):
        mask = np.pad(smooth == value, 1).astype(np.float32)
        # Contour a hair outside the half-way line, so neighbouring classes overlap rather than leave a seam.
        rings = [r for r in measure.find_contours(mask, 0.4) if len(r) >= 4]
        polygons = [shapely.Polygon(np.column_stack([(r[:, 1] - 1) * GRID - 180, 90 - (r[:, 0] - 1) * GRID])) for r in rings]
        area = shapely.symmetric_difference_all([shapely.make_valid(p) for p in polygons])
        features.append((shapely.simplify(area, GRID / 4), {'class': c}, None))
        print(f'  {c}: {len(rings)} rings', flush=True)
    write('biome', features)


def generalise(geometry, tolerance: float, min_area: float):
    """Drop parts and holes smaller than min_area (degrees²), then simplify."""
    polygons = []
    for part in getattr(geometry, 'geoms', [geometry]):
        if part.area < min_area:
            continue
        holes = [h for h in part.interiors if shapely.Polygon(h).area >= min_area]
        polygons.append(shapely.Polygon(part.exterior, holes))
    return shapely.make_valid(shapely.simplify(shapely.MultiPolygon(polygons), tolerance))


def bathymetry():
    features = []
    for path in sorted(SRC.rglob('ne_10m_bathymetry_*.shp')):
        depth = int(path.stem.rsplit('_', 1)[1])
        if depth not in DEPTHS:
            continue
        _, _, geometry, _ = pyogrio.raw.read(str(path), columns=[])
        area = shapely.union_all(shapely.from_wkb(geometry))
        features.append((generalise(area, GRID / 2, BATHYMETRY_MIN_AREA), {'depth': depth}, None))
    write('bathymetry', features)


def graticule():
    _, _, geometry, fields = pyogrio.raw.read(shp('ne_10m_geographic_lines'), columns=['name'])
    write('graticule', (
        (shapely.from_wkb(g), {'name': n}, None)
        for g, n in zip(geometry, fields[0])
        if 'Date Line' not in n
    ))


SMALL_WORDS = {'of', 'the', 'and', 'de', 'del', 'la', 'al'}


def readable(name: str) -> str:
    """Natural Earth shouts some names; set them in title case, abbreviations spelled out."""
    if not name.isupper():
        return name
    words = name.replace('MTS.', 'MOUNTAINS').lower().split()
    return ' '.join(w if i and w in SMALL_WORDS else w[:1].upper() + w[1:] for i, w in enumerate(words))


def names(record: dict) -> dict:
    name = record['name']
    out = {'name': readable(record.get('name_en') or name if name.isupper() else name)}
    for lang in LANGUAGES:
        value = record.get(f'name_{lang}')
        if value and value != out['name']:
            out[f'name:{lang}'] = value
    return out


def axis(polygon) -> LineString:
    """The long axis of a polygon's oriented bounding box, for labels laid along a range."""
    box = shapely.oriented_envelope(polygon)
    a, b, c, d = list(box.exterior.coords)[:4]
    mid = lambda p, q: ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
    if shapely.distance(shapely.Point(a), shapely.Point(b)) < shapely.distance(shapely.Point(b), shapely.Point(c)):
        start, end = mid(a, b), mid(c, d)
    else:
        start, end = mid(b, c), mid(d, a)
    return LineString(sorted([start, end]))


def largest(geometry):
    parts = getattr(geometry, 'geoms', [geometry])
    return max(parts, key=lambda p: p.area)


def read_records(path: str, columns: list[str]):
    meta, _, geometry, fields = pyogrio.raw.read(path, columns=columns)
    for i, g in enumerate(geometry):
        yield shapely.from_wkb(g), {c.lower(): f[i] for c, f in zip(meta['fields'], fields)}


def rank(r: dict) -> int:
    return int(float(r['scalerank']))


def minzoom(r: dict) -> int:
    return min(5, max(0, int(float(r['min_label'] or 1)) - 1))


def labels():
    lang_cols = [f'name_{l}' for l in LANGUAGES]
    features = []

    regions = {'Continent': 'continent', 'Range/mtn': 'range', 'Desert': 'desert', 'Plateau': 'plateau', 'Basin': 'basin', 'Peninsula': 'peninsula'}
    for geometry, r in read_records(shp('ne_10m_geography_regions_polys'), ['FEATURECLA', 'NAME', 'SCALERANK', 'MIN_LABEL'] + [c.upper() for c in lang_cols]):
        kind = regions.get(r['featurecla'])
        if not kind or rank(r) > (1 if kind in ('plateau', 'basin', 'peninsula') else 3):
            continue
        part = largest(geometry)
        anchor = axis(part) if kind == 'range' else polylabel(part, 0.05)
        features.append((anchor, {'class': kind, 'rank': rank(r), **names(r)}, minzoom(r)))

    for geometry, r in read_records(shp('ne_10m_geography_marine_polys'), ['featurecla', 'name', 'scalerank', 'min_label'] + lang_cols):
        if not r['name'] or rank(r) > 3:
            continue
        kind = 'ocean' if r['featurecla'] == 'ocean' else 'sea'
        anchor = polylabel(largest(geometry), 0.05)
        features.append((anchor, {'class': kind, 'rank': rank(r), **names(r)}, minzoom(r)))
    write('label', features)


for step in [globals()[name] for name in (sys.argv[3:] or ['biomes', 'bathymetry', 'graticule', 'labels'])]:
    step()
    print(f'{step.__name__}: done', flush=True)
