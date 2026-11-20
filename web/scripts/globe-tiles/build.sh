#!/usr/bin/env bash
# Build the zoomed-out globe tiles into web/public/globe/<version>/.
#
#   web/scripts/globe-tiles/build.sh [work-dir]
#
# Runs entirely in Docker. Sources are cached in the work dir (default
# /tmp/globe-tiles), so a rebuild after a style tweak skips the downloads.
# Bump VERSION whenever the output changes, so clients and the service worker
# never mix tiles from two builds.
set -euo pipefail

VERSION=v1
HERE="$(cd "$(dirname "$0")" && pwd)"
PUBLIC="$HERE/../../public/globe"
WORK="${1:-/tmp/globe-tiles}"
IMAGE=parchment/globe-tiles
MAXZOOM=5
RELIEF_MAXZOOM=4

NATURAL_EARTH=https://naciscdn.org/naturalearth/10m/physical
SOURCES=(
  "$NATURAL_EARTH/ne_10m_bathymetry_all.zip"
  "$NATURAL_EARTH/ne_10m_geographic_lines.zip"
  "$NATURAL_EARTH/ne_10m_geography_marine_polys.zip"
  "$NATURAL_EARTH/ne_10m_geography_regions_polys.zip"
  https://storage.googleapis.com/teow2016/Ecoregions2017.zip
)

mkdir -p "$WORK/src" "$WORK/dem"
for url in "${SOURCES[@]}"; do
  zip="$WORK/src/$(basename "$url")"
  [ -s "$zip" ] || curl -sSfL -o "$zip" "$url"
  [ -d "${zip%.zip}" ] || unzip -oq "$zip" -d "${zip%.zip}"
done

docker build -q -t "$IMAGE" "$HERE" >/dev/null
run() { docker run --rm --user "$(id -u):$(id -g)" -v "$WORK:/work" -v "$HERE:/app:ro" "$IMAGE" "$@"; }

rm -rf "$WORK/layers" "$WORK/out"
mkdir -p "$WORK/out"
run python /app/prepare.py /work/src /work/layers

# Low detail and doubled simplification below the top zoom: a whole-globe view is
# a few hundred pixels across, and the ocean bands are most of the weight. Every
# label point is kept (-r1): each already carries the zoom it should appear at.
run tippecanoe -q -e /work/out/vector -n globe -Z0 -z"$MAXZOOM" \
  --low-detail=10 --full-detail=11 -S 2 --detect-shared-borders -r1 \
  --no-feature-limit --no-tile-size-limit \
  -L biome:/work/layers/biome.geojsonl \
  -L bathymetry:/work/layers/bathymetry.geojsonl \
  -L graticule:/work/layers/graticule.geojsonl \
  -L label:/work/layers/label.geojsonl
rm -f "$WORK/out/vector/metadata.json"

run python /app/relief.py /work/out/relief /work/dem "$RELIEF_MAXZOOM"
run python /app/fill.py /work/out "$MAXZOOM" "$RELIEF_MAXZOOM"

rm -rf "$PUBLIC"
mkdir -p "$PUBLIC"
cp -r "$WORK/out" "$PUBLIC/$VERSION"
echo "globe tiles: $(find "$PUBLIC/$VERSION" -type f | wc -l) files, $(du -sh --apparent-size "$PUBLIC/$VERSION" | cut -f1)"
