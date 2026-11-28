import { describe, expect, test } from 'bun:test'
import { s256Challenge, verifyPkce } from './pkce'

// RFC 7636 Appendix B
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

describe('PKCE S256', () => {
  test('matches the RFC example', () => {
    expect(s256Challenge(VERIFIER)).toBe(CHALLENGE)
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true)
  })

  test('refuses a different verifier', () => {
    expect(verifyPkce(`${VERIFIER.slice(0, -1)}A`, CHALLENGE)).toBe(false)
  })

  test('refuses the challenge sent back as the verifier (plain method)', () => {
    expect(verifyPkce(CHALLENGE, CHALLENGE)).toBe(false)
  })

  test('refuses verifiers outside 43–128 unreserved characters', () => {
    const short = 'a'.repeat(42)
    const long = 'a'.repeat(129)
    expect(verifyPkce(short, s256Challenge(short))).toBe(false)
    expect(verifyPkce(long, s256Challenge(long))).toBe(false)
    const spaced = `${'a'.repeat(42)} `
    expect(verifyPkce(spaced, s256Challenge(spaced))).toBe(false)
  })

  test('refuses a malformed challenge', () => {
    expect(verifyPkce(VERIFIER, `${CHALLENGE}=`)).toBe(false)
    expect(verifyPkce(VERIFIER, '')).toBe(false)
  })
})
