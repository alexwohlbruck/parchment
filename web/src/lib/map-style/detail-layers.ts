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

/** Martin source names; see barrelman's `martin-config.yaml`. */
export const PARKING_TILES = 'parking_areas'
export const TREE_TILES = 'street_trees'

export const PARKING_LAYER = 'Parking'
export const PARKING_CASING_LAYER = 'Parking outline'
export const TREE_LAYER = 'Trees'

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
    parking: 'hsl(45, 20%, 89%)',
    parkingCasing: 'hsl(45, 14%, 80%)',
    tree: 'hsl(112, 38%, 46%)',
  },
  dark: {
    parking: 'hsl(216, 20%, 27%)',
    parkingCasing: 'hsl(216, 24%, 21%)',
    tree: 'hsl(112, 30%, 40%)',
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
 * Trees, as the flat mark that stands in for the 3D model.
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
  ]
}
