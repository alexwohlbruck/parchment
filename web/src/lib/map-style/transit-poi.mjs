/**
 * OpenMapTiles `poi.class` values that are transit stops.
 *
 * Shared between the style generator, which gives these a square blue plate
 * instead of a category disc, and the app, which hides them while the transit
 * layer group is drawing its own stops over the top. Both have to agree on the
 * list or the basemap keeps a stop the overlay has already drawn.
 */
export const TRANSIT_POI_CLASSES = [
  'bus', 'bus_stop', 'bus_station', 'railway', 'station', 'subway',
  'tram_stop', 'ferry_terminal', 'harbor', 'aerialway', 'airport',
]

/** True for a transit stop, as a style expression. */
export function isTransitPoi() {
  return ['match', ['get', 'class'], TRANSIT_POI_CLASSES, true, false]
}
