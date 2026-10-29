import type { NavRoute } from '../nav-route'

export interface BorderCrossing {
  /** Route distance of the border. */
  s: number
  /** ISO 3166-1 alpha-3 of the country entered. */
  country: string
}

/** Where the route enters another country, read off the edges' countries. */
export function borderCrossings(route: NavRoute): BorderCrossing[] {
  const crossings: BorderCrossing[] = []
  let current: string | undefined
  for (const edge of route.edges) {
    if (!edge.country) continue
    if (current && edge.country !== current) crossings.push({ s: edge.startDistance, country: edge.country })
    current = edge.country
  }
  return crossings
}
