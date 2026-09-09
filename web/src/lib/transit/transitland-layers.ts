export const TRANSITLAND_LAYER_IDS = {
  STOPS: 'transitland-stops',
  STOPS_LABELS: 'transitland-stops-labels',
  ROUTES: 'transitland',
  ROUTES_CASE: 'transitland-case',
  ROUTE_ACTIVE: 'transitland-route-active',
} as const

export function isTransitStopLayer(layerId?: string): boolean {
  if (!layerId) return false
  return (
    layerId === TRANSITLAND_LAYER_IDS.STOPS ||
    layerId === TRANSITLAND_LAYER_IDS.STOPS_LABELS
  )
}
