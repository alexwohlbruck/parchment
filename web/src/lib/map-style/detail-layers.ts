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

export const PARKING_SOURCE = 'parking'
export const TREE_SOURCE = 'trees'
export const TREE_ROW_SOURCE = 'tree-rows'
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
export const BUILDING_3D_SOURCE = 'buildings-3d'

/** Martin source names; see barrelman's `martin-config.yaml`. */
export const PARKING_TILES = 'parking_areas'
export const TREE_TILES = 'street_trees'
export const TREE_ROW_TILES = 'tree_rows'
export const FURNITURE_TILES = 'street_furniture'
export const BUILDING_3D_TILES = 'buildings_3d'

export const PARKING_LAYER = 'Parking'
export const PARKING_CASING_LAYER = 'Parking outline'
export const TREE_LAYER = 'Trees'
export const TREE_ROW_LAYER = 'Tree rows'
export const FURNITURE_LAYER = 'Street furniture'

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
  },
  dark: {
    parking: 'hsl(216, 20%, 27%)',
    parkingCasing: 'hsl(216, 24%, 21%)',
    tree: 'hsl(112, 30%, 40%)',
    furniture: 'hsl(210, 12%, 44%)',
  },
}

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
    [PARKING_SOURCE]: {
      type: 'vector' as const,
      tiles: [tileUrl(PARKING_TILES)],
      minzoom: 13,
      maxzoom: 16,
    },
    [TREE_SOURCE]: {
      type: 'vector' as const,
      tiles: [tileUrl(TREE_TILES)],
      minzoom: 16,
      maxzoom: 17,
    },
    [TREE_ROW_SOURCE]: {
      type: 'vector' as const,
      tiles: [tileUrl(TREE_ROW_TILES)],
      minzoom: 16,
      maxzoom: 17,
    },
    [FURNITURE_SOURCE]: {
      type: 'vector' as const,
      tiles: [tileUrl(FURNITURE_TILES)],
      minzoom: 17,
      maxzoom: 17,
    },
    // Zooms match the basemap's own building layer, so switching source changes
    // nothing about when buildings appear or when they start over-zooming.
    [BUILDING_3D_SOURCE]: {
      type: 'vector' as const,
      tiles: [tileUrl(BUILDING_3D_TILES)],
      minzoom: 14,
      maxzoom: 16,
    },
  }
}

/** The paved surface and its edge, drawn beneath the pedestrian block. */
export function parkingLayers(flavor: FlavorId): any[] {
  const c = DETAIL_COLORS[flavor]
  return [
    {
      id: PARKING_LAYER,
      type: 'fill',
      source: PARKING_SOURCE,
      'source-layer': PARKING_TILES,
      minzoom: 13,
      filter: SURFACE_ONLY,
      paint: { 'fill-color': c.parking },
    },
    {
      id: PARKING_CASING_LAYER,
      type: 'line',
      source: PARKING_SOURCE,
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
      source: TREE_SOURCE,
      'source-layer': TREE_TILES,
      minzoom: 16,
      paint: {
        'circle-color': c.tree,
        // A canopy, roughly: a street tree reads about 4m across, which is
        // this many pixels at each of these zooms.
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 16, 2, 20, 14],
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
      source: TREE_ROW_SOURCE,
      'source-layer': TREE_ROW_TILES,
      minzoom: 16,
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': c.tree,
        'line-width': ['interpolate', ['exponential', 2], ['zoom'], 16, 3, 20, 20],
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
