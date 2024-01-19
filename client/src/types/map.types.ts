export const basemaps = {
  standard: {
    name: "Standard",
    url: "mapbox://styles/mapbox/standard-beta",
  },
  aerial: {
    name: "Aerial",
    url: "mapbox://styles/mapbox/satellite-v9",
  },
};

export type Basemap = keyof typeof basemaps;
