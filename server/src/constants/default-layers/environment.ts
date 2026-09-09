import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

/**
 * Environment default layers — split into two real groups: Air Quality and
 * Wildfires (like Cycling/Transit).
 *
 * - Air Quality heatmap is a RASTER TILE layer (CAMS WMS, proxied) — caches
 *   per-tile, never refetches on pan.
 * - Fire hotspots + perimeters + smoke are vector geojson layers with EMPTY
 *   sources that environment-data.service.ts fills: fires by (padded) viewport
 *   so the point count stays bounded, perimeters/smoke as the whole national
 *   dataset. All render + toggle natively.
 */

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] } as const

export const ENVIRONMENT_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  // ── Air Quality ──────────────────────────────────────────────
  // CAMS (Copernicus) global PM2.5 surface (raster tiles)
  {
    templateId: 'default:env-aqi-heatmap',
    name: 'AQI heatmap',
    type: LayerType.CUSTOM,
    engine: ['mapbox', 'maplibre'],
    icon: 'WindIcon',
    showInLayerSelector: false,
    visible: false,
    order: 10,
    groupId: 'default:group:air-quality',
    isSubLayer: true,
    configuration: {
      id: 'env-aqi-heatmap',
      type: 'raster',
      source: {
        id: 'env-aqi-heatmap',
        type: 'raster',
        tiles: ['{SERVER_URL}/environment/tiles/aqi/{z}/{x}/{y}?sv=2'],
        tileSize: 256,
        attribution: 'Air quality: Copernicus CAMS',
      },
      paint: { 'raster-opacity': 0.45 },
    },
  },

  // ── Wildfires ────────────────────────────────────────────────
  // Fire hotspots — NASA FIRMS (vector circles, filled by viewport)
  {
    templateId: 'default:env-fire-hotspots',
    name: 'Fire hotspots',
    type: LayerType.CUSTOM,
    engine: ['mapbox', 'maplibre'],
    icon: 'FlameIcon',
    showInLayerSelector: false,
    visible: false,
    order: 20,
    groupId: 'default:group:wildfires',
    isSubLayer: true,
    integrationId: 'firms',
    configuration: {
      id: 'env-fire-hotspots',
      type: 'circle',
      source: { id: 'env-fire-hotspots', type: 'geojson', data: EMPTY_GEOJSON },
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'], 3, 1.8, 7, 3.5, 12, 6,
        ],
        'circle-color': '#ff3b13',
        'circle-opacity': 0.85,
        'circle-stroke-color': '#ffd000',
        'circle-stroke-width': 0.5,
      },
    },
  },

  // Fire perimeters — NIFC (whole dataset)
  {
    templateId: 'default:env-fire-perimeters',
    name: 'Fire perimeters',
    type: LayerType.CUSTOM,
    engine: ['mapbox', 'maplibre'],
    icon: 'HexagonIcon',
    showInLayerSelector: false,
    visible: false,
    order: 30,
    groupId: 'default:group:wildfires',
    isSubLayer: true,
    configuration: {
      id: 'env-fire-perimeters',
      type: 'fill',
      source: { id: 'env-fire-perimeters', type: 'geojson', data: EMPTY_GEOJSON },
      paint: {
        'fill-color': '#d84a00',
        'fill-opacity': 0.18,
        'fill-outline-color': '#8f1900',
      },
    },
  },

  // Smoke — NOAA HMS (whole dataset)
  {
    templateId: 'default:env-smoke',
    name: 'Smoke',
    type: LayerType.CUSTOM,
    engine: ['mapbox', 'maplibre'],
    icon: 'CloudIcon',
    showInLayerSelector: false,
    visible: false,
    order: 40,
    groupId: 'default:group:wildfires',
    isSubLayer: true,
    configuration: {
      id: 'env-smoke',
      type: 'fill',
      source: { id: 'env-smoke', type: 'geojson', data: EMPTY_GEOJSON },
      paint: {
        'fill-color': '#8a8f98',
        // HMS Density is "Light" | "Medium" | "Heavy"; scale by that × a zoom
        // falloff so smoke fades out over city streets.
        // Top-level zoom interpolate (required — `zoom` can't be nested), with
        // density-dependent stops so heavier smoke is more opaque. Fades out at
        // city zoom so it doesn't black out the streets.
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          3, ['match', ['get', 'Density'], 'Light', 0.1, 'Medium', 0.16, 'Heavy', 0.24, 0.15],
          6, ['match', ['get', 'Density'], 'Light', 0.08, 'Medium', 0.13, 'Heavy', 0.2, 0.12],
          10, ['match', ['get', 'Density'], 'Light', 0.04, 'Medium', 0.07, 'Heavy', 0.11, 0.07],
          14, ['match', ['get', 'Density'], 'Light', 0.015, 'Medium', 0.025, 'Heavy', 0.04, 0.025],
        ],
      },
    },
  },
]
