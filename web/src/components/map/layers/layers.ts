import {
  Layer,
  LayerType,
  MapboxLayerType,
  SourceType,
} from '@/types/map.types'
import {
  BikeIcon,
  CarFrontIcon,
  MapIcon,
  TrainIcon,
  PersonStandingIcon,
} from 'lucide-vue-next'
import { MapEngine } from '@/types/map.types'
import colors from 'tailwindcss/colors'

const mapboxAccessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const mapillaryAccessToken = import.meta.env.VITE_MAPILLARY_ACCESS_TOKEN

const mapillaryOverview: Layer = {
  name: 'Mapillary Overview',
  enabled: true,
  visible: false,
  type: LayerType.STREET_VIEW,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  configuration: {
    id: 'mapillary-overview',
    type: MapboxLayerType.CIRCLE,
    source: {
      id: 'mapillary-overview',
      type: SourceType.VECTOR,
      tiles: [
        `https://tiles.mapillary.com/maps/vtp/mly1_computed_public/2/{z}/{x}/{y}?access_token=${mapillaryAccessToken}`,
      ],
      minzoom: 0,
      maxzoom: 5,
    },
    'source-layer': 'images',
    paint: {
      'circle-color': colors.blue[500],
      'circle-radius': 4,
      'circle-opacity': 1,
      'circle-stroke-color': colors.blue[800],
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.7,
      'circle-emissive-strength': 1,
    },
  },
}

const mapillarySequence: Layer = {
  name: 'Mapillary Sequences',
  enabled: true,
  visible: false,
  type: LayerType.STREET_VIEW,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  configuration: {
    id: 'mapillary-sequence',
    type: MapboxLayerType.LINE,
    slot: 'middle',
    source: {
      id: 'mapillary-sequence',
      type: SourceType.VECTOR,
      tiles: [
        `https://tiles.mapillary.com/maps/vtp/mly1_computed_public/2/{z}/{x}/{y}?access_token=${mapillaryAccessToken}`,
      ],
      minzoom: 6,
      maxzoom: 14,
    },
    'source-layer': 'sequence',
    paint: {
      'line-color': colors.blue[500],
      'line-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        6,
        0,
        14,
        1,
        22,
        0.5,
      ],
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0, 7, 1, 14, 2],
      'line-emissive-strength': 1,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  },
}

const mapillaryImage: Layer = {
  name: 'Mapillary Images',
  enabled: true,
  visible: false,
  type: LayerType.STREET_VIEW,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  configuration: {
    id: 'mapillary-image',
    type: MapboxLayerType.CIRCLE,
    slot: 'middle',
    source: {
      id: 'mapillary-image',
      type: SourceType.VECTOR,
      tiles: [
        `https://tiles.mapillary.com/maps/vtp/mly1_computed_public/2/{z}/{x}/{y}?access_token=${mapillaryAccessToken}`,
      ],
      minzoom: 6,
      maxzoom: 14,
    },
    'source-layer': 'image',
    paint: {
      'circle-color': colors.blue[500],
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14,
        0,
        16,
        3,
        22,
        6,
      ],
      'circle-opacity': 1,
      'circle-stroke-color': colors.blue[800],
      'circle-stroke-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14,
        0,
        16,
        2,
      ],
      'circle-stroke-opacity': 0.7,
      'circle-emissive-strength': 1,
    },
  },
}

const cyclOSM: Layer = {
  name: 'CyclOSM',
  icon: BikeIcon,
  enabled: true,
  visible: false,
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  configuration: {
    id: 'cyclosm',
    type: MapboxLayerType.RASTER,
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
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  configuration: {
    id: 'waymarkedTrails',
    type: MapboxLayerType.RASTER,
    slot: 'middle',
    source: {
      id: 'waymarkedTrails',
      type: SourceType.RASTER,
      tiles: ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png'],
      tileSize: 512,
      attribution:
        '<a href="https://cycling.waymarkedtrails.org/">© Waymarked Trails</a>',
    },
  },
}

// https://loom.cs.uni-freiburg.de/tiles/subway-lightrail/geo/13/2258/3240.mvt
const loomLightRail: Layer = {
  name: 'Loom Light Rail',
  icon: TrainIcon,
  enabled: true,
  visible: false,
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  configuration: {
    id: 'loom-light-rail',
    type: MapboxLayerType.LINE,
    slot: 'middle',
    source: {
      id: 'loom-light-rail',
      type: SourceType.VECTOR,
      tiles: [
        'https://loom.cs.uni-freiburg.de/tiles/subway-lightrail/geo/{z}/{x}/{y}.mvt',
      ],
      maxzoom: 17,
    },
    'source-layer': 'lines',
    paint: {
      'line-color': ['concat', '#', ['get', 'color']],
      'line-width': 5,
      'line-opacity': 1,
      'line-emissive-strength': 1,
      'line-occlusion-opacity': 0.15,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  },
}

const loomTram: Layer = {
  name: 'Loom Tram',
  icon: TrainIcon,
  enabled: true,
  visible: false,
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  configuration: {
    id: 'loom-tram',
    type: MapboxLayerType.LINE,
    slot: 'middle',
    source: {
      id: 'loom-tram',
      type: SourceType.VECTOR,
      tiles: ['https://loom.cs.uni-freiburg.de/tiles/tram/geo/{z}/{x}/{y}.mvt'],
      maxzoom: 17,
    },
    'source-layer': 'lines',
    paint: {
      'line-color': ['concat', '#', ['get', 'color']],
      'line-width': 5,
      'line-opacity': 1,
      'line-emissive-strength': 1,
      'line-occlusion-opacity': 0.15,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  },
}

const loomRailCommuter: Layer = {
  name: 'Loom Rail (Commuter)',
  icon: TrainIcon,
  enabled: true,
  visible: false,
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  configuration: {
    id: 'loom-rail-commuter',
    type: MapboxLayerType.LINE,
    slot: 'middle',
    source: {
      id: 'loom-rail-commuter',
      type: SourceType.VECTOR,
      tiles: [
        'https://loom.cs.uni-freiburg.de/tiles/rail-commuter/geo/{z}/{x}/{y}.mvt',
      ],
      maxzoom: 17,
    },
    'source-layer': 'lines',
    paint: {
      'line-color': ['concat', '#', ['get', 'color']],
      'line-width': 5,
      'line-opacity': 1,
      'line-emissive-strength': 1,
      'line-occlusion-opacity': 0.15,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  },
}

const loomRail: Layer = {
  name: 'Loom Rail (Long Distance)',
  icon: TrainIcon,
  enabled: true,
  visible: false,
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  configuration: {
    id: 'loom-rail',
    type: MapboxLayerType.LINE,
    slot: 'middle',
    source: {
      id: 'loom-rail',
      type: SourceType.VECTOR,
      tiles: ['https://loom.cs.uni-freiburg.de/tiles/rail/geo/{z}/{x}/{y}.mvt'],
      maxzoom: 17,
    },
    'source-layer': 'lines',
    paint: {
      'line-color': ['concat', '#', ['get', 'color']],
      'line-width': 5,
      'line-opacity': 1,
      'line-emissive-strength': 1,
      'line-occlusion-opacity': 0.15,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  },
}

// const loomLightRailStations: Layer = {
//   name: 'Loom Light Rail Stations',
//   icon: TrainIcon,
//   enabled: true,
//   visible: true,
//   type: LayerType.CUSTOM,
//   engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
//   configuration: {
//     id: 'loom-light-rail-stations',
//     type: MapboxLayerType.FILL,
//     source: {
//       id: 'loom-light-rail-stations',
//       type: SourceType.VECTOR,
//       tiles: [
//         'https://loom.cs.uni-freiburg.de/tiles/subway-lightrail/geo/{z}/{x}/{y}.mvt',
//       ],
//       maxzoom: 17,
//     },
//     'source-layer': 'stations',
//     paint: {
//       'fill-color': '#0d0d8a',
//       'fill-opacity': 1,
//       'fill-outline-color': '#ffffff',
//       'fill-emissive-strength': 1,
//     },
//   },
// }

// const loomTramStations: Layer = {
//   name: 'Loom Tram Stations',
//   icon: TrainIcon,
//   enabled: true,
//   visible: true,
//   type: LayerType.CUSTOM,
//   engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
//   configuration: {
//     id: 'loom-tram-stations',
//     type: MapboxLayerType.FILL,
//     source: {
//       id: 'loom-tram-stations',
//       type: SourceType.VECTOR,
//       tiles: ['https://loom.cs.uni-freiburg.de/tiles/tram/geo/{z}/{x}/{y}.mvt'],
//       maxzoom: 17,
//     },
//     'source-layer': 'stations',
//     paint: {
//       'fill-color': '#0d0d8a',
//       'fill-opacity': 1,
//       'fill-outline-color': '#ffffff',
//       'fill-emissive-strength': 1,
//     },
//   },
// }

// const loomRailCommuterStations: Layer = {
//   name: 'Loom Rail (Commuter) Stations',
//   icon: TrainIcon,
//   enabled: true,
//   visible: true,
//   type: LayerType.CUSTOM,
//   engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
//   configuration: {
//     id: 'loom-rail-commuter-stations',
//     type: MapboxLayerType.FILL,
//     source: {
//       id: 'loom-rail-commuter-stations',
//       type: SourceType.VECTOR,
//       tiles: [
//         'https://loom.cs.uni-freiburg.de/tiles/rail-commuter/geo/{z}/{x}/{y}.mvt',
//       ],
//       maxzoom: 17,
//     },
//     'source-layer': 'stations',
//     paint: {
//       'fill-color': '#0d0d8a',
//       'fill-opacity': 1,
//       'fill-outline-color': '#ffffff',
//       'fill-emissive-strength': 1,
//     },
//   },
// }

// const loomRailStations: Layer = {
//   name: 'Loom Rail (Long Distance) Stations',
//   icon: TrainIcon,
//   enabled: true,
//   visible: true,
//   type: LayerType.CUSTOM,
//   engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
//   configuration: {
//     id: 'loom-rail-stations',
//     type: MapboxLayerType.FILL,
//     source: {
//       id: 'loom-rail-stations',
//       type: SourceType.VECTOR,
//       tiles: ['https://loom.cs.uni-freiburg.de/tiles/rail/geo/{z}/{x}/{y}.mvt'],
//       maxzoom: 17,
//     },
//     'source-layer': 'stations',
//     paint: {
//       'fill-color': '#0d0d8a',
//       'fill-opacity': 1,
//       'fill-outline-color': '#ffffff',
//       'fill-emissive-strength': 1,
//     },
//   },
// }

const transitlandApiKey = import.meta.env.VITE_TRANSITLAND_API_KEY
const transitLand: Layer = {
  name: 'Transitland',
  icon: TrainIcon,
  enabled: true,
  visible: false,
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  configuration: {
    id: 'transitland',
    type: MapboxLayerType.LINE,
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
  enabled: true,
  visible: false,
  type: LayerType.CUSTOM,
  engine: [MapEngine.MAPBOX],
  configuration: {
    id: 'traffic',
    type: MapboxLayerType.LINE,
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
  mapillaryOverview,
  mapillarySequence,
  mapillaryImage,
  cyclOSM,
  waymarkedTrails,
  loomTram,
  // loomTramStations,
  loomLightRail,
  // loomLightRailStations,
  loomRailCommuter,
  // loomRailCommuterStations,
  loomRail,
  // loomRailStations,
  transitLand,
  traffic,
] as Layer[]
