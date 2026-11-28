import { createHash, timingSafeEqual } from 'node:crypto'

/** RFC 7636 §4.1: 43–128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/
const S256_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/

export function isValidCodeChallenge(challenge: string): boolean {
  return S256_CHALLENGE.test(challenge)
}

export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !isValidCodeChallenge(challenge)) return false
  return timingSafeEqual(Buffer.from(s256Challenge(verifier)), Buffer.from(challenge))
}
