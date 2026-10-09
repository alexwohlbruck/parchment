/**
 * Map detail Parchment draws that OpenMapTiles has no schema for.
 *
 * Our basemap is a stock OpenMapTiles build, and it carries no parking polygons
 * — parking survives only as a `poi` point and as `service=parking_aisle`
 * centrelines — and no individual trees. Both are already in Barrelman's
 * `geo_places`, so they are served from there as their own vector sources
 * (`import/create-detail-views.sql` and `martin-config.yaml` in that repo)
 * rather than waiting on a custom Planetiler profile and a full pmtiles
 * rebuild, which is a manual job measured in hours.
 *
 * These layers are hand-authored rather than converted, which is why they live
 * here instead of in `spec.json`: that file is MapTiler's Streets v2 with our
 * tokens substituted, and `convert-basemap-style.mjs` regenerates it wholesale.
 * Their colours are declared here for the same reason — the token files are
 * generated too.
 */
import type { FlavorId } from './build'

/**
 * One source for every detail overlay a client reads at z≤16.
 *
 * These used to be five separate vector sources, which meant five tile
 * requests for every tile of ground — and a map view is thirty to sixty tiles
 * *per source*. Barrelman serves them as a single bundle (`/tiles/detail`),
 * each still arriving as its own layer under its own name, so only the
 * `source` changed here. Measured against the deployment, a six-tile viewport
 * over Manhattan went from 18 requests to 6, and from 2.04 s to 1.14 s warm.
 */
export const DETAIL_SOURCE = 'detail'

/**
 * Street furniture cannot join the bundle, so it stays its own source.
 *
 * It is minzoom 17 upstream, and a bundle is read at z≤16 — so it could
 * contribute nothing to a `detail` tile, and folding it in would take benches
 * and bins off the map rather than speed them up. Drop its minzoom to 16 in
 * barrelman's `martin-config.yaml` and it joins, at which point this source
 * and the `detail` entry below collapse into one.
 */
export const FURNITURE_SOURCE = 'furniture'
/**
 * 3D buildings, served by Barrelman rather than read off the basemap.
 *
 * OpenStreetMap maps a detailed building twice — an outline tagged `building=*`
 * over the whole footprint and `building:part=*` polygons inside it carrying the
 * real heights — and a 3D map must draw the parts and not the outline, or it
 * draws both and they z-fight. OpenMapTiles marks the outline `hide_3d` for
 * exactly this, and a stock build of it does not: our basemap's building layer
 * carries `colour`, `render_height` and `render_min_height` and nothing else, so
 * every part-mapped building came out doubled.
 *
 * Barrelman works the flag out from the geometry (`buildings_3d` in
 * `import/create-detail-views.sql`) and serves the roof colour with it, which
 * the OpenMapTiles schema has no field for at all.
 *
 * The flat `Building` fill still comes from the basemap. Two footprints painted
 * the same colour on top of each other look like one, so the outline costs
 * nothing there, and the basemap is the cheaper source for it.
 */
/**
 * 3D landmark placements: a point per landmark, carrying its model and the
 * buildings it replaces. Its own source rather than a bundle member, because
 * it is not Martin — Barrelman builds these tiles itself — and because it may
 * one day be served from somewhere else entirely. See `map-objects/landmarks.ts`.
 */
export const LANDMARK_SOURCE = 'landmarks'
/** Barrelman's path under /tiles, and the tile's layer name. */
export const LANDMARK_TILES = 'landmarks'
export const LANDMARK_LAYER = 'Landmarks'

/**
 * `buildings_3d` as a source of its own, for a Barrelman that serves it but
 * not yet the `detail` bundle. Only added to the style when that is the case;
 * see `barrelmanBuildingsTiles`.
 */
export const BUILDINGS_SOURCE = 'buildings'

/** The barrelman bundle behind {@link DETAIL_SOURCE}; see its `TILE_BUNDLES`. */
export const DETAIL_TILES = 'detail'

/** Martin source names; see barrelman's `martin-config.yaml`. */
export const PARKING_TILES = 'parking_areas'
export const TREE_TILES = 'street_trees'
export const TREE_ROW_TILES = 'tree_rows'
export const FURNITURE_TILES = 'street_furniture'
export const BUILDING_3D_TILES = 'buildings_3d'
export const COASTER_TRACK_TILES = 'coaster_tracks'

export const PARKING_LAYER = 'Parking'
export const PARKING_CASING_LAYER = 'Parking outline'
export const TREE_LAYER = 'Trees'
export const TREE_ROW_LAYER = 'Tree rows'
export const FURNITURE_LAYER = 'Street furniture'
export const COASTER_TRACK_LAYER = 'Coaster track'
export const COASTER_TRACK_CASING_LAYER = 'Coaster track casing'

/** Every layer that is the flat stand-in for a 3D object; see `TREE_OPACITY`. */
export const OBJECT_FLAT_LAYERS = [TREE_LAYER, TREE_ROW_LAYER, FURNITURE_LAYER]

/**
 * The flat form's opacity ramp, so the 3D form can put it back.
 *
 * Hiding the circles has to be done with paint rather than `visibility`: a
 * layer set to `none` stops being a consumer of its source, MapLibre stops
 * loading the tiles, and the object layer — which reads its instances out of
 * those same tiles — is left with nothing to draw. The building shade layer
 * mutes the extrusion the same way and for the same reason.
 */
export const TREE_OPACITY = [
  'interpolate', ['linear'], ['zoom'], 16, 0.55, 17.5, 0.85,
] as any

/**
 * A lot is paving, so it takes a paved colour — a touch greyer and a touch
 * darker than the ground it sits on, the way Mapbox Standard separates one.
 * Not the pedestrian surface's colour: a car park is not somewhere you walk,
 * and reading as one would be worse than reading as nothing.
 */
const DETAIL_COLORS: Record<FlavorId, Record<string, string>> = {
  light: {
    parking: 'hsl(228, 12%, 89%)',
    parkingCasing: 'hsl(228, 11%, 80%)',
    // The disc a tree draws when 3D objects are off, so it has to land where
    // the model's own foliage lands — see `OBJECT_PALETTE` in `map-objects`.
    tree: 'hsl(104, 40%, 55%)',
    furniture: 'hsl(210, 12%, 52%)',
    // Galvanised steel, for a track OSM gives no colour: a cool mid grey,
    // darker than the paving so it reads as a structure standing on it.
    coaster: 'hsl(212, 10%, 52%)',
    coasterCasing: 'hsla(212, 14%, 98%, 0.85)',
  },
  dark: {
    parking: 'hsl(216, 20%, 27%)',
    parkingCasing: 'hsl(216, 24%, 21%)',
    tree: 'hsl(112, 30%, 40%)',
    furniture: 'hsl(210, 12%, 44%)',
    coaster: 'hsl(212, 12%, 62%)',
    coasterCasing: 'hsla(216, 30%, 12%, 0.8)',
  },
}

/**
 * How far a track's own `colour` is pulled toward the flavor's steel: OSM
 * colours are written as the paint looks in a brochure, and a pure `red`
 * thread is the loudest thing on the map. Further at night, where a saturated
 * line reads as lit rather than painted (the same reason `BUILDING_TINT` is
 * quieter at night).
 */
const COASTER_STEEL_PULL: Record<FlavorId, number> = { light: 0.25, dark: 0.45 }

/**
 * Multi-storey and underground parking are not ground at all — the first is a
 * building, which the basemap already draws, and the second is not visible from
 * above. Painting either as a surface puts a grey slab over a tower.
 */
const SURFACE_ONLY = [
  'match',
  ['get', 'parking'],
  ['multi-storey', 'underground', 'rooftop', 'sheds', 'carports', 'garage_boxes'],
  false,
  true,
] as any

export function detailSources(tileUrl: (source: string) => string) {
  return {
    /**
     * The bundle's window is the union of its members': `bicycle_ways` starts
     * at 9, `parking_areas` at 13, `buildings_3d` and `coaster_tracks` at 14, the
     * trees at 16, and
     * every one of them stops at 16. A member below its own floor contributes
     * nothing to the tile, so the low zooms cost only what the cycling layers
     * put there — and MapLibre asks for nothing at all until a *visible* layer
     * consumes the source, which below z13 means only the cycling layers, and
     * they ship hidden.
     *
     * Stopping at 16 is what keeps buildings on the map above it: the tile is
     * over-zoomed from 16 the way the basemap is over-zoomed from 14. Letting
     * the source run to 17 would ask for a tile that `buildings_3d` no longer
     * answers at, and they would vanish rather than over-zoom.
     */
    [DETAIL_SOURCE]: {
      type: 'vector' as const,
      tiles: [tileUrl(DETAIL_TILES)],
      minzoom: 9,
      maxzoom: 16,
    },
    [FURNITURE_SOURCE]: {
      type: 'vector' as const,
      tiles: [tileUrl(FURNITURE_TILES)],
      minzoom: 17,
      maxzoom: 17,
    },
    // Barrelman answers from z12 and the set barely changes past 14, so the
    // tile is over-zoomed from there like the basemap is.
    [LANDMARK_SOURCE]: {
      type: 'vector' as const,
      tiles: [tileUrl(LANDMARK_TILES)],
      minzoom: 12,
      maxzoom: 14,
    },
  }
}

/**
 * What keeps the landmark tiles loading. Never seen: the landmark layer reads
 * the placements with `querySourceFeatures`, which only finds what some style
 * layer has caused to load — the same reason the flat trees are muted rather
 * than hidden (see `TREE_OPACITY`).
 */
export function landmarkLayers(): any[] {
  return [
    {
      id: LANDMARK_LAYER,
      type: 'circle',
      source: LANDMARK_SOURCE,
      'source-layer': LANDMARK_TILES,
      minzoom: 12,
      paint: { 'circle-opacity': 0, 'circle-radius': 1 },
    },
  ]
}

/** The paved surface and its edge, drawn beneath the pedestrian block. */
export function parkingLayers(flavor: FlavorId): any[] {
  const c = DETAIL_COLORS[flavor]
  return [
    {
      id: PARKING_LAYER,
      type: 'fill',
      source: DETAIL_SOURCE,
      'source-layer': PARKING_TILES,
      minzoom: 13,
      filter: SURFACE_ONLY,
      paint: { 'fill-color': c.parking },
    },
    {
      id: PARKING_CASING_LAYER,
      type: 'line',
      source: DETAIL_SOURCE,
      'source-layer': PARKING_TILES,
      // A lot's edge is only worth drawing once the lot is big enough to read
      // as a shape rather than as a smudge.
      minzoom: 15,
      filter: SURFACE_ONLY,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': c.parkingCasing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.5, 19, 1.2],
      },
    },
  ]
}

/**
 * Trees and street furniture, as the flat marks that stand in for the models.
 *
 * This is what draws when 3D objects are off — and, since the two forms are the
 * same features from the same source, turning them on is a matter of muting
 * this layer rather than loading anything else. Future object layers (benches,
 * bins) follow the same shape: a flat form here, a model in `map-objects`.
 */
export function treeLayers(flavor: FlavorId): any[] {
  const c = DETAIL_COLORS[flavor]
  return [
    {
      id: TREE_LAYER,
      type: 'circle',
      source: DETAIL_SOURCE,
      'source-layer': TREE_TILES,
      minzoom: 14.5,
      paint: {
        'circle-color': c.tree,
        // A canopy, roughly: a street tree reads about 4m across, which is
        // this many pixels at each of these zooms.
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 14.5, 0.8, 16, 2, 20, 14],
        'circle-opacity': TREE_OPACITY,
        'circle-pitch-alignment': 'map',
      },
    },
    {
      // A row of trees is one line in OSM, so flat it stays a line — a dashed
      // green thread reads as planting where a string of dots would read as a
      // path. The 3D form walks the same line and plants along it.
      id: TREE_ROW_LAYER,
      type: 'line',
      source: DETAIL_SOURCE,
      'source-layer': TREE_ROW_TILES,
      minzoom: 14.5,
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': c.tree,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 14.5, 1.2, 16, 3, 20, 20],
        'line-opacity': TREE_OPACITY,
        'line-blur': 1,
      },
    },
    {
      // Furniture flat is a dot and nothing more. At the one zoom it draws at
      // there is no room for an icon, and a bin does not want a label.
      id: FURNITURE_LAYER,
      type: 'circle',
      source: FURNITURE_SOURCE,
      'source-layer': FURNITURE_TILES,
      minzoom: 17,
      paint: {
        'circle-color': c.furniture,
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 17, 1.5, 20, 6],
        'circle-opacity': TREE_OPACITY,
        'circle-pitch-alignment': 'map',
      },
    },
  ]
}

/**
 * Roller coaster tracks, as a slim rail over a faint casing.
 *
 * From the bundle's `coaster_tracks` (barrelman's `create-detail-views.sql`),
 * which serves a closed track as its ring, so both layers here are only ever
 * fed lines. Where a 3D landmark models the coaster, its track ways are among
 * the landmark's `replaces` and the strategy filters them out of both layers
 * the moment the model is ready — see `REPLACEABLE_SOURCE_LAYERS`.
 *
 * `colour` is OSM's, so anything goes: `to-color` tries it and falls through
 * to steel when it is missing or is not a colour MapLibre can parse.
 *
 * `layer` orders the stretches that pass over each other. Only within a
 * layer — the casing still draws under every rail — but that is what costs
 * nothing, and a crossing reads well enough without the casing interleaved.
 */
export function coasterTrackLayers(flavor: FlavorId): any[] {
  const c = DETAIL_COLORS[flavor]
  const color = [
    'interpolate', ['linear'], COASTER_STEEL_PULL[flavor],
    0, ['to-color', ['get', 'colour'], c.coaster],
    1, c.coaster,
  ]
  const sortKey = ['coalesce', ['get', 'layer'], 0]
  const width = (extra: number) =>
    ['interpolate', ['exponential', 1.6], ['zoom'], 14, 0.6 + extra, 16, 1.4 + extra, 18, 2.6 + extra * 1.5, 20, 5 + extra * 2]
  const common = {
    type: 'line',
    source: DETAIL_SOURCE,
    'source-layer': COASTER_TRACK_TILES,
    minzoom: 14,
  }
  return [
    {
      ...common,
      id: COASTER_TRACK_CASING_LAYER,
      layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': sortKey },
      paint: { 'line-color': c.coasterCasing, 'line-width': width(1.6) },
    },
    {
      ...common,
      id: COASTER_TRACK_LAYER,
      layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': sortKey },
      paint: { 'line-color': color, 'line-width': width(0) },
    },
  ]
}

/** The basemap's woodland fill, which turns to bare soil under the 3D forest. */
export const WOOD_LAYER = 'Wood'

const FOREST_FLOOR: Record<FlavorId, string> = {
  light: 'hsl(32, 36%, 60%)',
  dark: 'hsl(30, 22%, 22%)',
}

/** Fades from the wood's own colour to soil as the forest fills in at z15. */
export function forestFloorColor(wood: unknown, flavor: FlavorId): any {
  return ['interpolate', ['linear'], ['zoom'], 14.5, wood, 15.5, FOREST_FLOOR[flavor]]
}

/** The colour `forestFloorColor` was built from, or the value unchanged. */
export function woodColorOf(paint: unknown): any {
  return Array.isArray(paint) && paint[0] === 'interpolate' ? paint[4] : paint
}
