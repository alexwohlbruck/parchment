import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { authMockModule, resetAuth, setAuthUser, TEST_USER } from '../test/auth-mock'
import { createTestApp, req } from '../test/app'

mock.module('../middleware/auth.middleware', () => authMockModule())

let permitted = true
mock.module('../services/auth.service', () => ({
  getPermissions: async () => (permitted ? ['premium:ask'] : []),
  hasPermission: (perms: string[], rule: string) => perms.includes(rule),
}))

const place = {
  id: 'osm/node/1',
  name: { value: 'Blue Bottle', sourceId: 'osm' },
  placeType: { value: 'Café', sourceId: 'osm' },
  geometry: { value: { type: 'point', center: { lat: 40.7, lng: -74 } }, sourceId: 'osm' },
  address: null,
  openingHours: null,
  amenities: {},
}
const lookupPlacesByNameAndLocation = mock(async (..._args: unknown[]) => [place])
mock.module('../services/place.service', () => ({
  lookupPlacesByNameAndLocation,
  lookupEnrichedPlaceById: async () => null,
}))
mock.module('../services/search.service', () => ({ searchByCategory: async () => [] }))
mock.module('../services/category.service', () => ({ categoryService: { searchCategories: () => [] } }))
mock.module('../services/geocoding.service', () => ({ forwardGeocode: async () => ({ results: [] }) }))
mock.module('../services/barrelman.service', () => ({ requestBarrelman: async () => new Response('{}') }))

const { askTools } = await import('../services/ask/ask-tools')
const { default: mcp } = await import('./mcp.controller')
const app = createTestApp(mcp)

const rpc = (method: string, params?: Record<string, unknown>) =>
  req(app).post('/mcp', { body: { jsonrpc: '2.0', id: 1, method, params } })

const callTool = (name: string, args: Record<string, unknown>) =>
  rpc('tools/call', { name, arguments: args })

beforeEach(() => {
  resetAuth()
  permitted = true
  lookupPlacesByNameAndLocation.mockClear()
})

describe('MCP endpoint', () => {
  test('negotiates the protocol version and advertises tools', async () => {
    const { body } = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.capabilities).toEqual({ tools: {} })

    const fallback = await rpc('initialize', { protocolVersion: '1999-01-01' })
    expect(fallback.body.result.protocolVersion).toBe('2025-11-25')
  })

  test('acknowledges notifications without a body', async () => {
    const response = await req(app).post('/mcp', {
      body: { jsonrpc: '2.0', method: 'notifications/initialized' },
    })
    expect(response.status).toBe(202)
  })

  test('lists every Ask tool with its schema and no answer tool', async () => {
    const { body } = await rpc('tools/list')
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      askTools.map((tool) => tool.name),
    )
    expect(body.result.tools[0].inputSchema).toEqual(askTools[0].parameters)
  })

  test('runs a tool for the signed-in user and returns its result as JSON text', async () => {
    const near = { lat: 40.7, lng: -74 }
    const { body } = await callTool('find_places', { query: 'coffee', near })
    expect(body.result.isError).toBeUndefined()
    expect(JSON.parse(body.result.content[0].text).places).toEqual([
      expect.objectContaining({ id: place.id }),
    ])
    expect(lookupPlacesByNameAndLocation).toHaveBeenCalledWith(
      'coffee',
      near,
      expect.objectContaining({ userId: TEST_USER.id }),
    )
  })

  test('reports a failed tool as a tool error, not a protocol error', async () => {
    const { body } = await callTool('find_places', { query: 'coffee' })
    expect(body.result).toEqual({
      content: [{ type: 'text', text: 'No location: call locate first, or ask the user where' }],
      isError: true,
    })
    expect(lookupPlacesByNameAndLocation).not.toHaveBeenCalled()
  })

  test('rejects unknown tools and methods with JSON-RPC errors', async () => {
    expect((await callTool('answer', {})).body.error.code).toBe(-32602)
    expect((await rpc('resources/list')).body.error.code).toBe(-32601)
  })

  test('rejects unauthenticated and unpermitted callers', async () => {
    setAuthUser(null)
    const anonymous = await rpc('tools/list')
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('www-authenticate')).toBe('Bearer')
    expect(anonymous.body).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32001 } })

    resetAuth()
    permitted = false
    const forbidden = await rpc('tools/list')
    expect(forbidden.status).toBe(403)
    expect(forbidden.body.error.code).toBe(-32003)
  })

  test('offers no event stream or sessions', async () => {
    expect((await req(app).get('/mcp')).status).toBe(405)
    expect((await req(app).delete('/mcp')).status).toBe(405)
  })
})
