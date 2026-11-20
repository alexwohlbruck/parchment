# Globe tiles

The zoomed-out map's biomes, ocean depths, relief, reference lines and
physical-geography names. The basemap carries almost nothing below z6, so these
fill the globe until it takes over. `src/lib/map-style/globe-layers.ts` styles
them.

    web/scripts/globe-tiles/build.sh [work-dir]

The build runs in Docker (Python, GEOS, tippecanoe) and writes
`web/public/globe/<version>/`. Bump `VERSION` in `build.sh` and in
`globe-layers.ts` together whenever the output changes.

| Output | Zooms | Built from |
|---|---|---|
| `vector/{z}/{x}/{y}.pbf.gz`: `biome`, `bathymetry`, `graticule`, `label` | 0–5 | see below |
| `relief/{z}/{x}/{y}.webp`: translucent hillshade, 256 px | 0–4 | Mapterhorn elevation, z4 |

- **Biomes** are rasterised onto a 0.05° grid, extended a little past the coast,
  smoothed so speckle merges into its surroundings, and traced back into
  polygons. The coarse grid is the point: from orbit a biome should read as a
  soft region, not a coastline-accurate patchwork.
- **Ocean depth** is eight nested bands from 200 m to 8000 m, with seamounts
  and basins under about 25 km across dropped. The basemap's own water is the
  shelf.
- **Vector tiles are gzipped on disk** and inflated in the browser, because
  static hosts serve `.pbf` without compression.
- **Every tile position has a file**, empty where there is nothing to draw.
  A static host answers a missing file with the app's `index.html`.

## Sources

- [Natural Earth](https://www.naturalearthdata.com/) 1:10m bathymetry,
  geographic lines, marine and region names. Public domain.
- [RESOLVE Ecoregions 2017](https://ecoregions.appspot.com/), Dinerstein et
  al. Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Grouped into nine biome classes and generalised.
- [Mapterhorn](https://mapterhorn.com/attribution) elevation, shaded and
  reduced. Attributed alongside the map's terrain.
