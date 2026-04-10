/**
 * Basemap Style Configuration
 *
 * Decouples map strategy logic from specific style layer IDs. Each basemap
 * style (OSM Liberty, OSM OpenMapTiles, etc.) exports a config that tells
 * the strategy which layers to target for toggles, POI interaction, etc.
 *
 * All styles that target the OpenMapTiles schema share the same tile source
 * (`openmaptiles`) and source-layer names (`poi`, `transportation`, etc.),
 * but their *rendered layer IDs* differ per style.
 *
 * The ID parsing (Planetiler vs Mapbox encoding) depends on the tile source,
 * not the style, so it lives in the strategy / map.utils.
 */

import type { MapStyleId } from '@/types/map.types'

export interface BasemapStyleConfig {
  /** Human-readable name for UI display */
  name: string

  /** Vector tile source ID used by this style (e.g. 'openmaptiles') */
  sourceId: string

  /** Rendered layer IDs for POI icons/labels (used for click + hover) */
  poiLayerIds: string[]

  /** Rendered layer IDs for road labels and shields */
  roadLabelLayerIds: string[]

  /** Rendered layer IDs for transit/rail lines */
  transitLayerIds: string[]

  /** Rendered layer IDs for place name labels (cities, countries, etc.) */
  placeLabelLayerIds: string[]

  /** Rendered layer ID for 3D extruded buildings (null if style has none) */
  buildingLayerId: string | null

  /** OMT property names for building extrusion height */
  buildingHeightProperty: string
  buildingMinHeightProperty: string
}

// ---------------------------------------------------------------------------
// OSM Liberty
// ---------------------------------------------------------------------------

export const osmLibertyConfig: BasemapStyleConfig = {
  name: 'OSM Liberty',
  sourceId: 'openmaptiles',
  poiLayerIds: ['poi_z14', 'poi_z15', 'poi_z16', 'poi_transit'],
  roadLabelLayerIds: [
    'road_label',
    'road_shield',
    'road_one_way_arrow',
    'road_one_way_arrow_opposite',
  ],
  transitLayerIds: [
    'road_major_rail',
    'road_major_rail_hatching',
    'road_transit_rail',
    'road_transit_rail_hatching',
    'tunnel_major_rail',
    'tunnel_major_rail_hatching',
    'tunnel_transit_rail',
    'tunnel_transit_rail_hatching',
    'bridge_major_rail',
    'bridge_major_rail_hatching',
    'bridge_transit_rail',
    'bridge_transit_rail_hatching',
  ],
  placeLabelLayerIds: [
    'place_other',
    'place_village',
    'place_town',
    'place_city',
    'state',
    'country_1',
    'country_2',
    'country_3',
    'continent',
  ],
  buildingLayerId: 'building-3d',
  buildingHeightProperty: 'render_height',
  buildingMinHeightProperty: 'render_min_height',
}

// ---------------------------------------------------------------------------
// OSM OpenMapTiles (Bright)
// ---------------------------------------------------------------------------

export const osmOpenMapTilesConfig: BasemapStyleConfig = {
  name: 'OSM OpenMapTiles',
  sourceId: 'openmaptiles',
  poiLayerIds: ['poi-level-1', 'poi-level-2', 'poi-level-3', 'poi-railway'],
  roadLabelLayerIds: [
    'highway-name-path',
    'highway-name-minor',
    'highway-name-major',
    'highway-shield',
    'highway-shield-us-interstate',
    'highway-shield-us-other',
    'road_oneway',
    'road_oneway_opposite',
  ],
  transitLayerIds: [
    'railway-transit',
    'railway-transit-hatching',
    'railway-service',
    'railway-service-hatching',
    'railway',
    'railway-hatching',
    'tunnel-railway',
    'bridge-railway',
    'bridge-railway-hatching',
  ],
  placeLabelLayerIds: [
    'place-other',
    'place-village',
    'place-town',
    'place-city',
    'place-city-capital',
    'place-state',
    'place-country-other',
    'place-country-3',
    'place-country-2',
    'place-country-1',
    'place-continent',
  ],
  // OSM OpenMapTiles uses flat fill for buildings, no 3D extrusions
  buildingLayerId: null,
  buildingHeightProperty: 'render_height',
  buildingMinHeightProperty: 'render_min_height',
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const styleConfigs: Record<MapStyleId, BasemapStyleConfig> = {
  'osm-liberty': osmLibertyConfig,
  'osm-openmaptiles': osmOpenMapTilesConfig,
}

/** Get the config for a given style ID, falling back to OSM Liberty */
export function getStyleConfig(styleId: MapStyleId): BasemapStyleConfig {
  return styleConfigs[styleId] ?? osmLibertyConfig
}
