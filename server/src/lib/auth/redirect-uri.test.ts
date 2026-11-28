import { describe, expect, test } from 'bun:test'
import { isAllowedRedirectUri, redirectUriMatches } from './redirect-uri'

describe('isAllowedRedirectUri', () => {
  test('allows HTTPS, loopback HTTP and app schemes', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(isAllowedRedirectUri('http://localhost:6274/oauth/callback')).toBe(true)
    expect(isAllowedRedirectUri('http://127.0.0.1/callback')).toBe(true)
    expect(isAllowedRedirectUri('cursor://anysphere.cursor-mcp/oauth/callback')).toBe(true)
  })

  test('refuses plain HTTP elsewhere, script schemes, fragments and garbage', () => {
    expect(isAllowedRedirectUri('http://example.com/callback')).toBe(false)
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false)
    expect(isAllowedRedirectUri('data:text/html,hi')).toBe(false)
    expect(isAllowedRedirectUri('https://example.com/cb#frag')).toBe(false)
    expect(isAllowedRedirectUri('not a uri')).toBe(false)
  })
})

describe('redirectUriMatches', () => {
  test('needs an exact match for remote URIs', () => {
    expect(redirectUriMatches('https://a.example/cb', 'https://a.example/cb')).toBe(true)
    expect(redirectUriMatches('https://a.example/cb', 'https://a.example/cb/')).toBe(false)
    expect(redirectUriMatches('https://a.example/cb', 'https://a.example:8443/cb')).toBe(false)
  })

  test('lets a loopback URI change only its port', () => {
    expect(redirectUriMatches('http://localhost:3000/cb', 'http://localhost:51234/cb')).toBe(true)
    expect(redirectUriMatches('http://localhost:3000/cb', 'http://localhost:3000/other')).toBe(false)
    expect(redirectUriMatches('http://localhost:3000/cb', 'http://127.0.0.1:3000/cb')).toBe(false)
  })
})
