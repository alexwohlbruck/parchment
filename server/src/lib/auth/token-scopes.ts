import { TOKEN_SCOPES, type TokenScope } from '../../types/access-token.types'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface RouteRule {
  prefix: string
  methods: Method[]
  /** Null lets any scoped token through; the route checks scopes itself. */
  scope: TokenScope | null
}

const WRITES: Method[] = ['POST', 'PUT', 'PATCH', 'DELETE']

/** Everything a scoped token can reach over REST; the longest matching prefix decides. Anything unlisted needs a full session. */
const ROUTE_RULES: RouteRule[] = [
  { prefix: '/mcp', methods: ['POST'], scope: null },
  { prefix: '/places', methods: ['GET'], scope: 'places:read' },
  { prefix: '/search', methods: ['GET', 'POST'], scope: 'places:read' },
  { prefix: '/geocoding', methods: ['GET'], scope: 'places:read' },
  { prefix: '/directions', methods: ['GET', 'POST'], scope: 'trips:read' },
  { prefix: '/directions/trips', methods: ['GET'], scope: 'trips:read' },
  { prefix: '/transit', methods: ['GET'], scope: 'trips:read' },
  { prefix: '/gbfs', methods: ['GET'], scope: 'trips:read' },
  { prefix: '/isochrone', methods: ['GET'], scope: 'trips:read' },
  { prefix: '/weather', methods: ['GET'], scope: 'weather:read' },
  { prefix: '/environment', methods: ['GET'], scope: 'weather:read' },
  { prefix: '/library', methods: ['GET'], scope: 'library:read' },
  { prefix: '/vehicles', methods: ['GET'], scope: 'library:read' },
  { prefix: '/library', methods: WRITES, scope: 'library:write' },
]

const TOOL_SCOPES: Record<string, TokenScope> = {
  find_places: 'places:read',
  find_categories: 'places:read',
  browse_category: 'places:read',
  get_place: 'places:read',
  locate: 'places:read',
  what_is_here: 'places:read',
  places_within_reach: 'places:read',
  search_along_route: 'places:read',
  find_place_on_web: 'places:read',
  plan_trip: 'trips:read',
  travel_times: 'trips:read',
  transit_trips: 'trips:read',
  transit_departures: 'trips:read',
  transit_line: 'trips:read',
  bikeshare_nearby: 'trips:read',
  weather: 'weather:read',
  wildfires: 'weather:read',
  saved_places: 'library:read',
  my_collections: 'library:read',
  my_routes: 'library:read',
  my_canvases: 'library:read',
  my_vehicles: 'library:read',
  save_place: 'library:write',
  create_route: 'library:write',
  edit_route: 'library:write',
  create_canvas: 'library:write',
  share_canvas: 'library:write',
  archive: 'library:write',
}

function underPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

export type RouteAccess =
  | { allowed: true }
  | { allowed: false; scope: TokenScope | null }

/** Whether a token holding `scopes` may call `method path`, and if not, which scope it lacks. */
export function routeAccess(scopes: readonly TokenScope[], method: string, path: string): RouteAccess {
  const matching = ROUTE_RULES.filter((candidate) => underPrefix(path, candidate.prefix))
  const longest = Math.max(0, ...matching.map((candidate) => candidate.prefix.length))
  const rule = matching.find(
    (candidate) =>
      candidate.prefix.length === longest &&
      candidate.methods.includes(method.toUpperCase() as Method),
  )
  if (!rule) return { allowed: false, scope: null }
  if (rule.scope === null || scopes.includes(rule.scope)) return { allowed: true }
  return { allowed: false, scope: rule.scope }
}

/** The scope an MCP tool needs; unknown tools need one no token has. */
export function toolScope(toolName: string): TokenScope | undefined {
  return TOOL_SCOPES[toolName]
}

export function isTokenScope(value: string): value is TokenScope {
  return (TOKEN_SCOPES as readonly string[]).includes(value)
}

/** The known scopes in a space-separated OAuth `scope` string, deduplicated and in canonical order. */
export function parseScopes(scope: string | undefined | null): TokenScope[] {
  const requested = new Set((scope ?? '').split(/\s+/).filter(Boolean))
  return TOKEN_SCOPES.filter((known) => requested.has(known))
}

/** RFC 6750 §3: what a token lacks, so a client can ask for more. */
export function insufficientScopeChallenge(scope: TokenScope | null) {
  return `Bearer error="insufficient_scope"${scope ? `, scope="${scope}"` : ''}`
}

export function formatScopes(scopes: readonly TokenScope[]): string {
  return scopes.join(' ')
}
