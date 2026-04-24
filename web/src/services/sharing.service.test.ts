/**
 * Unit tests for the pure helpers exposed by the client sharing service.
 * HTTP-calling helpers (`listSharesForResource`, `createShare`,
 * `createPublicLink`, …) are covered by manual E2E in Chrome; adding a
 * mocked-axios suite here would duplicate that signal without catching
 * real regressions.
 */

import { describe, test, expect } from 'vitest'
import { buildPublicLinkUrl } from './sharing.service'

describe('buildPublicLinkUrl', () => {
  test('joins server URL + token at /public/collections/', () => {
    const url = buildPublicLinkUrl(
      'https://parchment.app',
      'abc123_token',
    )
    expect(url).toBe('https://parchment.app/public/collections/abc123_token')
  })

  test('strips trailing slash on the server URL', () => {
    // Important: concatenation would produce a double slash otherwise,
    // which some CDNs + browsers normalize inconsistently.
    const url = buildPublicLinkUrl(
      'https://parchment.app/',
      'tok',
    )
    expect(url).toBe('https://parchment.app/public/collections/tok')
  })

  test('works for localhost dev URLs', () => {
    const url = buildPublicLinkUrl('http://localhost:5000', 'dev_tok')
    expect(url).toBe('http://localhost:5000/public/collections/dev_tok')
  })
})
