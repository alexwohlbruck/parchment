import { describe, expect, test } from 'bun:test'
import { parseScopes, routeAccess } from './token-scopes'

describe('routeAccess', () => {
  test('a read scope reaches its reads', () => {
    expect(routeAccess(['library:read'], 'GET', '/library/collections')).toEqual({ allowed: true })
    expect(routeAccess(['places:read'], 'POST', '/search/category')).toEqual({ allowed: true })
  })

  test('a write needs the write scope', () => {
    expect(routeAccess(['library:read'], 'POST', '/library/collections')).toEqual({
      allowed: false,
      scope: 'library:write',
    })
    expect(routeAccess(['library:write'], 'DELETE', '/library/routes/abc')).toEqual({ allowed: true })
  })

  test('the longest matching prefix decides', () => {
    expect(routeAccess(['trips:read'], 'POST', '/directions')).toEqual({ allowed: true })
    expect(routeAccess(['trips:read'], 'GET', '/directions/trips/abc')).toEqual({ allowed: true })
    expect(routeAccess(['trips:read'], 'POST', '/directions/trips')).toEqual({ allowed: false, scope: null })
  })

  test('account, session and token routes are out of reach of every scope', () => {
    const all = parseScopes('places:read trips:read weather:read library:read library:write')
    for (const [method, path] of [
      ['GET', '/auth/tokens'],
      ['POST', '/auth/tokens'],
      ['GET', '/auth/sessions/current'],
      ['GET', '/users/me/preferences'],
      ['POST', '/oauth/authorize'],
      ['POST', '/ask'],
      ['PUT', '/places/listings'],
    ]) {
      expect(routeAccess(all, method, path)).toEqual({ allowed: false, scope: null })
    }
  })

  test('matches whole path segments only', () => {
    expect(routeAccess(['library:read'], 'GET', '/library-export')).toEqual({ allowed: false, scope: null })
  })

  test('any scoped token reaches MCP, which checks each tool itself', () => {
    expect(routeAccess(['weather:read'], 'POST', '/mcp')).toEqual({ allowed: true })
    expect(routeAccess(['weather:read'], 'GET', '/mcp')).toEqual({ allowed: false, scope: null })
  })
})

describe('parseScopes', () => {
  test('keeps known scopes once, in canonical order', () => {
    expect(parseScopes('library:write  places:read nonsense places:read')).toEqual([
      'places:read',
      'library:write',
    ])
  })

  test('an empty or missing string has no scopes', () => {
    expect(parseScopes('')).toEqual([])
    expect(parseScopes(undefined)).toEqual([])
  })
})
