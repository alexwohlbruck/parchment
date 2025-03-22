export const MarkerIds = {
  SELECTED_POI: 'selected-poi',
} as const

export const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter'
export const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000'
