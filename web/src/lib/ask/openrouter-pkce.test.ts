import { describe, expect, it } from 'vitest'
import { authorizeUrl, codeChallenge, randomToken } from './openrouter-pkce'

describe('codeChallenge', () => {
  it('matches the RFC 7636 S256 example', async () => {
    expect(await codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('authorizeUrl', () => {
  it('asks for an S256 code bound to our state', () => {
    const url = new URL(
      authorizeUrl({ callbackUrl: 'https://app.test/cb', challenge: 'c', state: 's', keyLabel: 'Parchment' }),
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      callback_url: 'https://app.test/cb',
      code_challenge: 'c',
      code_challenge_method: 'S256',
      state: 's',
      key_label: 'Parchment',
    })
  })
})

describe('randomToken', () => {
  it('is url-safe', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
