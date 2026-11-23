/**
 * The satellite basemap's sources when the user hasn't chosen any, top first.
 * Each fills in where the ones above it have no imagery.
 */
export const DEFAULT_IMAGERY_STACK = [
  'default:imagery-usgs-naip',
  'default:imagery-esri',
] as const
