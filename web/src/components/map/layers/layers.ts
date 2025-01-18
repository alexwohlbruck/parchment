import { Layer, LayerType, SourceType } from '@/types/map.types'
import { BikeIcon, CarFrontIcon, TrainIcon } from 'lucide-vue-next'
import { MapEngine } from '@/types/map.types'

const mapboxAccessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

const cyclOSM: Layer = {
  name: 'CyclOSM',
  icon: BikeIcon,
  enabled: true,
  visible: false,
  engine: 'mapbox',
  configuration: {
    id: 'cyclosm',
    type: LayerType.RASTER,
    slot: 'middle',
    source: {
      id: 'cyclosm',
      type: SourceType.RASTER,
      tiles: [
        'https://a.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '<a href="https://www.opencyclemap.org/">© OpenCycleMap</a>',
    },
    paint: {
      'raster-emissive-strength': 0.9,
      'raster-hue-rotate': 290,
      'raster-saturation': 0.3,
    },
  },
}

const waymarkedTrails: Layer = {
  name: 'Waymarked Trails',
  icon: BikeIcon,
  enabled: true,
  visible: false,
  engine: 'mapbox',
  configuration: {
    id: 'waymarkedTrails',
    type: LayerType.RASTER,
    slot: 'middle',
    source: {
      id: 'waymarkedTrails',
      type: SourceType.RASTER,
      tiles: ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '<a href="https://cycling.waymarkedtrails.org/">© Waymarked Trails</a>',
    },
    paint: {
      'raster-emissive-strength': 0.9,
    },
  },
}

const transitlandApiKey = import.meta.env.VITE_TRANSITLAND_API_KEY
const transitLand: Layer = {
  name: 'Transitland',
  icon: TrainIcon,
  enabled: true,
  visible: false,
  engine: 'mapbox',
  configuration: {
    id: 'transitland',
    type: LayerType.LINE,
    slot: 'middle',
    source: {
      id: 'transitland',
      type: SourceType.VECTOR,
      tiles: [
        `https://transit.land/api/v2/tiles/routes/tiles/{z}/{x}/{y}.pbf?apikey=${transitlandApiKey}`,
      ],
      maxzoom: 14,
    },
    'source-layer': 'routes',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      'symbol-placement': 'line',
      'text-field': ['get', 'route_long_name'], // use the route_name property for the text
      'text-size': 12,
      'text-offset': [0, 1], // adjust the text offset if needed,
    },
    paint: {
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 18, 6],
      'line-color': [
        'match',
        ['get', 'route_type'],
        0, // Tram, streetcar, light rail
        ['coalesce', ['get', 'route_color'], 'blue'],
        1, // Subway, metro
        ['coalesce', ['get', 'route_color'], 'blue'],
        2, // Rail
        'red', // amtrak
        3, // Bus
        ['coalesce', ['get', 'route_color'], 'lightblue'], // busses
        4, // Ferry
        'blue',
        5, // Cable tram
        'purple',
        6, // Aerial lift, suspended cable car
        'pink',
        7, // Funicular
        'brown',
        11, // Trolleybus
        'black',
        12, // Monorail
        'red',
        'grey', // default
      ],
      'line-occlusion-opacity': 0.15,
      // 'line-opacity': [
      //   'match',
      //   ['get', 'route_type'],
      //   0, // Tram, streetcar, light rail
      //   1,
      //   1, // Subway, metro
      //   1,
      //   2, // Rail
      //   1,
      //   3, // Bus
      //   1,
      //   4, // Ferry
      //   1,
      //   5, // Cable tram
      //   1,
      //   6, // Aerial lift, suspended cable car
      //   1,
      //   7, // Funicular
      //   1,
      //   11, // Trolleybus
      //   1,
      //   12, // Monorail
      //   1,
      //   0,
      // ],
      // 'line-blur': 1
      // 'line-offset': 1
      'line-emissive-strength': 1,
    },
  },
}

// mapbox://mapbox.mapbox-traffic-v1
const traffic: Layer = {
  name: 'Mapbox traffic',
  icon: CarFrontIcon,
  enabled: false,
  visible: false,
  engine: 'mapbox',
  configuration: {
    id: 'traffic',
    type: LayerType.LINE,
    slot: 'middle',
    source: {
      id: 'traffic',
      type: SourceType.VECTOR,
      url: 'mapbox://mapbox.mapbox-traffic-v1',
      attribution: 'Mapbox',
      // tiles: [
      //   `https://a.tiles.mapbox.com/v4/mapbox.mapbox-streets-v7/{z}/{x}/{y}.vector.pbf?access_token=${mapboxAccessToken}`,
      // ],
    },
    'source-layer': 'traffic',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 20, 7],
      'line-offset': ['interpolate', ['linear'], ['zoom'], 14, 0, 20, 2],
      'line-color': [
        'match',
        ['get', 'congestion'],
        'low',
        '#1A9641',
        'moderate',
        '#EED322',
        'heavy',
        '#E6B71E',
        'severe',
        '#DA3838',
        '#000000',
      ],
      'line-opacity': 0.8,
      'line-occlusion-opacity': 0.15,
      'line-emissive-strength': 1,
    },
  },
}

export const layers: Layer[] = [
  cyclOSM,
  waymarkedTrails,
  transitLand,
  traffic,
] as Layer[]
