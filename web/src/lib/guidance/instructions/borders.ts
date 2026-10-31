import type { NavRoute } from '../nav-route'

/** A state entered this soon after a country is the same border, drawn a little apart in two datasets. */
const SAME_BORDER_METERS = 1000

/** Where the route enters another country, by its ISO 3166-1 alpha-3 code, or another state or province, by name. */
export type BorderCrossing = { s: number } & ({ country: string; state?: never } | { state: string; country?: never })

/** Read off the edges: a country entered outranks the state entered with it. Unknown stretches between don't count as a change. */
export function borderCrossings(route: NavRoute): BorderCrossing[] {
  const crossings: BorderCrossing[] = []
  let country: string | undefined
  let state: string | undefined
  for (const edge of route.edges) {
    if (edge.country && country && edge.country !== country) crossings.push({ s: edge.startDistance, country: edge.country })
    else if (edge.state && state && edge.state !== state) {
      const last = crossings.at(-1)
      if (!last?.country || edge.startDistance - last.s > SAME_BORDER_METERS) crossings.push({ s: edge.startDistance, state: edge.state })
    }
    country = edge.country ?? country
    state = edge.state ?? state
  }
  return crossings
}
