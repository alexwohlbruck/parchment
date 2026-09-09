import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

/**
 * The Transit group's template-backed layers.
 *
 * The transitland route/stop line + label templates that used to live here
 * are retired: the portolan ribbons (rendered client-side by
 * web/src/services/layers/features/portolan/, streamed from Barrelman
 * through the server proxy) supersede them as the group's route map. Only
 * the OSM-derived station infrastructure remains template-driven — the
 * portolan class toggles (Rail/Bus/Ferry/Other) are synthetic selector
 * rows, not tile-URL layers, so they cannot ride this file.
 */
export const TRANSIT_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  // ── Station infrastructure (OSM-derived, from Barrelman/Martin) ────
  // Station Buildings — polygonal outlines of transit stations
  {
    templateId: 'default:transit-station-buildings',
    name: 'Station Buildings',
    type: LayerType.TRANSIT,
    engine: ['mapbox', 'maplibre'],
    icon: 'TrainIcon',
    showInLayerSelector: false,
    visible: false,
    order: 0,
    groupId: 'default:group:transit',
    isSubLayer: true,
    integrationId: 'barrelman',
    configuration: {
      id: 'transit-station-buildings',
      type: 'fill',
      slot: 'middle',
      source: {
        id: 'transit-station-buildings',
        type: 'vector',
        tiles: ['{PROXY_URL}/barrelman/transit_station_buildings/{z}/{x}/{y}'],
        maxzoom: 16,
      },
      'source-layer': 'transit_station_buildings',
      minzoom: 14,
      layout: {},
      paint: {
        'fill-color': [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsla(220, 30%, 30%, 0.35)',
          0.3,
          'hsla(220, 20%, 75%, 0.35)',
        ],
        'fill-outline-color': [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsla(220, 30%, 50%, 0.6)',
          0.3,
          'hsla(220, 20%, 55%, 0.6)',
        ],
      },
    },
  },
  // Transit Platforms — platform shapes
  {
    templateId: 'default:transit-platforms',
    name: 'Transit Platforms',
    type: LayerType.TRANSIT,
    engine: ['mapbox', 'maplibre'],
    icon: 'TrainIcon',
    showInLayerSelector: false,
    visible: false,
    order: 0,
    groupId: 'default:group:transit',
    isSubLayer: true,
    integrationId: 'barrelman',
    configuration: {
      id: 'transit-platforms',
      type: 'fill',
      slot: 'middle',
      source: {
        id: 'transit-platforms',
        type: 'vector',
        tiles: ['{PROXY_URL}/barrelman/transit_platforms/{z}/{x}/{y}'],
        maxzoom: 16,
      },
      'source-layer': 'transit_platforms',
      minzoom: 15,
      layout: {},
      paint: {
        'fill-color': [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsla(220, 25%, 40%, 0.45)',
          0.3,
          'hsla(220, 15%, 68%, 0.45)',
        ],
        'fill-outline-color': [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsla(220, 30%, 55%, 0.7)',
          0.3,
          'hsla(220, 20%, 50%, 0.7)',
        ],
      },
    },
  },
  // Transit Entrances — subway and station entrance markers
  {
    templateId: 'default:transit-entrances',
    name: 'Station Entrances',
    type: LayerType.TRANSIT,
    engine: ['mapbox', 'maplibre'],
    icon: 'TrainIcon',
    showInLayerSelector: false,
    visible: false,
    order: 21,
    groupId: 'default:group:transit',
    isSubLayer: true,
    integrationId: 'barrelman',
    configuration: {
      id: 'transit-entrances',
      type: 'circle',
      slot: 'middle',
      source: {
        id: 'transit-entrances',
        type: 'vector',
        tiles: ['{PROXY_URL}/barrelman/transit_entrances/{z}/{x}/{y}'],
        maxzoom: 16,
      },
      'source-layer': 'transit_entrances',
      minzoom: 15,
      layout: {},
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          15,
          3,
          16,
          4,
          18,
          6,
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'wheelchair'], 'yes'],
          '#2563eb',
          '#6366f1',
        ],
        'circle-stroke-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          15,
          1.5,
          18,
          2,
        ],
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.9,
        'circle-emissive-strength': 1,
      },
    },
  },
  // Transit Entrance Labels
  {
    templateId: 'default:transit-entrance-labels',
    name: 'Station Entrance Labels',
    type: LayerType.TRANSIT,
    engine: ['mapbox', 'maplibre'],
    icon: 'TrainIcon',
    showInLayerSelector: false,
    visible: false,
    order: 23,
    groupId: 'default:group:transit',
    isSubLayer: true,
    integrationId: 'barrelman',
    configuration: {
      id: 'transit-entrance-labels',
      type: 'symbol',
      slot: 'top',
      source: {
        id: 'transit-entrances',
        type: 'vector',
        tiles: ['{PROXY_URL}/barrelman/transit_entrances/{z}/{x}/{y}'],
        maxzoom: 16,
      },
      'source-layer': 'transit_entrances',
      minzoom: 16,
      filter: ['any', ['!=', ['get', 'description'], ''], ['!=', ['get', 'name'], '']],
      layout: {
        'text-field': [
          'case',
          ['!=', ['get', 'name'], ''],
          ['get', 'name'],
          ['!=', ['get', 'description'], ''],
          ['get', 'description'],
          '',
        ],
        'text-font': [
          ['concat', ['config', 'font'], ' Medium'],
          'DIN Pro',
          'Inter',
          'Arial Unicode MS Bold',
        ],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          16,
          9,
          18,
          11,
        ],
        'text-offset': [1.2, 0],
        'text-anchor': 'left',
        'text-max-width': 12,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color': [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(230, 60%, 80%)',
          0.3,
          'hsl(230, 50%, 40%)',
        ],
        'text-halo-width': 1.5,
        'text-halo-blur': 0,
        'text-halo-color': [
          'interpolate',
          ['linear'],
          ['measure-light', 'brightness'],
          0.25,
          'hsl(0, 0%, 5%)',
          0.3,
          'hsl(0, 0%, 100%)',
        ],
        'text-emissive-strength': 1,
      },
    },
  },
]
