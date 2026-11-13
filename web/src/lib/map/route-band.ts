/** Marks a planned trip's own line, which the transit and cycling networks must stay under. */
export const ROUTE_BAND = { 'parchment:band': 'route' } as const

export const isRouteBand = (l: { metadata?: unknown }) =>
  (l.metadata as Record<string, unknown> | undefined)?.['parchment:band'] === 'route'
