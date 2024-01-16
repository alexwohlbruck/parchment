const cyclOSM = {
  name: "CyclOSM",
  enabled: true,
  source: {
    type: "raster",
    tiles: [
      "https://a.tile-cyclosm.openstreetmap.fr/cyclosm-lite/{z}/{x}/{y}.png",
    ],
    tileSize: 256,
    attribution: '<a href="https://www.opencyclemap.org/">© OpenCycleMap</a>',
  },
  meta: {
    type: "raster",
  },
};

const waymarkedTrails = {
  name: "Waymarked Trails",
  enabled: false,
  source: {
    type: "raster",
    tiles: ["https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png"],
    tileSize: 256,
    attribution:
      '<a href="https://cycling.waymarkedtrails.org/">© Waymarked Trails</a>',
  },
  meta: {
    type: "raster",
  },
};

const transitlandApiKey = import.meta.env.VITE_TRANSITLAND_API_KEY;
const transitLand = {
  name: "Transitland",
  enabled: false,
  source: {
    id: "transitland",
    type: "vector",
    tiles: [
      `https://transit.land/api/v2/tiles/routes/tiles/{z}/{x}/{y}.pbf?apikey=${transitlandApiKey}`,
    ],
    maxzoom: 14,
  },
  meta: {
    id: "transitland",
    type: "line",
    source: "transitland",
    slot: "middle",
    "source-layer": "routes",
    layout: {
      "line-cap": "round",
      "line-join": "round",
      "symbol-placement": "line",
      "text-field": ["get", "route_long_name"], // use the route_name property for the text
      "text-size": 12,
      "text-offset": [0, 1], // adjust the text offset if needed,
    },
    paint: {
      "line-width": 2.0,
      "line-color": [
        "match",
        ["get", "route_type"],
        0, // Tram, streetcar, light rail
        ["coalesce", ["get", "route_color"], "blue"],
        1, // Subway, metro
        ["coalesce", ["get", "route_color"], "blue"],
        2, // Rail
        "red", // amtrak
        3, // Bus
        ["coalesce", ["get", "route_color"], "lightblue"], // busses
        4, // Ferry
        "blue",
        5, // Cable tram
        "purple",
        6, // Aerial lift, suspended cable car
        "pink",
        7, // Funicular
        "brown",
        11, // Trolleybus
        "black",
        12, // Monorail
        "red",
        "grey", // default
      ],
      "line-opacity": [
        "match",
        ["get", "route_type"],
        0, // Tram, streetcar, light rail
        1,
        1, // Subway, metro
        1,
        2, // Rail
        1,
        3, // Bus
        1,
        4, // Ferry
        1,
        5, // Cable tram
        1,
        6, // Aerial lift, suspended cable car
        1,
        7, // Funicular
        1,
        11, // Trolleybus
        1,
        12, // Monorail
        1,
        0,
      ],
      // 'line-blur': 1
      // 'line-offset': 1
    },
  },
};

export default {
  cycle: {
    layers: [cyclOSM, waymarkedTrails],
    name: "Cycling",
  },
  transit: {
    layers: [transitLand],
    name: "Transit",
  },
};
