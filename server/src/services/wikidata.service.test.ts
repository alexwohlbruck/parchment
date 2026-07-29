/**
 * Unit tests for Wikidata lookups.
 *
 * These feed optional place/brand decoration, so every failure path must
 * return null rather than throw — a Wikimedia outage should drop a logo, not
 * break a place page.
 *
 * Wikimedia rejects requests without a descriptive User-Agent (403), so the
 * brand-meta path asserts the header is sent. The two-step shape (entity claim
 * → Commons file URL) is also pinned, including the case where the entity has
 * no image claim and the second request must be skipped entirely.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createAxiosMock } from '../test/axios-mock'

const http = createAxiosMock()
mock.module('axios', () => http.module)

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const {
  fetchWikidataImage,
  fetchWikidataBrandMeta,
  fetchWikidataBrandLogo,
} = await import('./wikidata.service')

const ok = (data: unknown) => ({ status: 200, data })

/** A Commons imageinfo response for a resolved file. */
const commonsResponse = (url: string) =>
  ok({ query: { pages: { '123': { imageinfo: [{ url }] } } } })

beforeEach(() => {
  http.reset()
})

describe('fetchWikidataImage', () => {
  test('resolves the P18 claim to a Commons URL', async () => {
    http.get
      .mockResolvedValueOnce(
        ok({ claims: { P18: [{ mainsnak: { datavalue: { value: 'Pic.jpg' } } }] } }),
      )
      .mockResolvedValueOnce(commonsResponse('https://commons.test/Pic.jpg'))

    expect(await fetchWikidataImage('Q42')).toBe('https://commons.test/Pic.jpg')
  })

  test('returns null without an id, making no request', async () => {
    expect(await fetchWikidataImage(undefined)).toBeNull()
    expect(http.get).not.toHaveBeenCalled()
  })

  test('returns null when the entity has no image claim', async () => {
    http.get.mockResolvedValueOnce(ok({ claims: {} }))

    expect(await fetchWikidataImage('Q42')).toBeNull()
    // The Commons round-trip is skipped.
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  test('url-encodes the file name for Commons', async () => {
    http.get
      .mockResolvedValueOnce(
        ok({
          claims: { P18: [{ mainsnak: { datavalue: { value: 'My Pic.jpg' } } }] },
        }),
      )
      .mockResolvedValueOnce(commonsResponse('https://commons.test/My%20Pic.jpg'))

    await fetchWikidataImage('Q42')

    expect(http.get.mock.calls[1][0]).toContain('My%20Pic.jpg')
  })

  test('returns null on a non-200 from Wikidata', async () => {
    http.get.mockResolvedValueOnce({ status: 404, data: {} })

    expect(await fetchWikidataImage('Q42')).toBeNull()
  })

  test('returns null on a non-200 from Commons', async () => {
    http.get
      .mockResolvedValueOnce(
        ok({ claims: { P18: [{ mainsnak: { datavalue: { value: 'Pic.jpg' } } }] } }),
      )
      .mockResolvedValueOnce({ status: 500, data: {} })

    expect(await fetchWikidataImage('Q42')).toBeNull()
  })

  test('returns null when Commons has no imageinfo', async () => {
    http.get
      .mockResolvedValueOnce(
        ok({ claims: { P18: [{ mainsnak: { datavalue: { value: 'Pic.jpg' } } }] } }),
      )
      .mockResolvedValueOnce(ok({ query: { pages: {} } }))

    expect(await fetchWikidataImage('Q42')).toBeNull()
  })

  test('swallows a network error', async () => {
    http.get.mockRejectedValueOnce(new Error('ENOTFOUND'))

    expect(await fetchWikidataImage('Q42')).toBeNull()
  })
})

describe('fetchWikidataBrandMeta', () => {
  const entity = (over: object = {}) =>
    ok({
      entities: {
        Q38076: {
          descriptions: { en: { value: 'Coffee chain' } },
          claims: { P154: [{ mainsnak: { datavalue: { value: 'Logo.svg' } } }] },
          ...over,
        },
      },
    })

  test('returns both the logo and the description', async () => {
    http.get
      .mockResolvedValueOnce(entity())
      .mockResolvedValueOnce(commonsResponse('https://commons.test/Logo.svg'))

    expect(await fetchWikidataBrandMeta('Q38076')).toEqual({
      logoUrl: 'https://commons.test/Logo.svg',
      description: 'Coffee chain',
    })
  })

  test('returns nulls without an id and makes no request', async () => {
    expect(await fetchWikidataBrandMeta(undefined)).toEqual({
      logoUrl: null,
      description: null,
    })
    expect(http.get).not.toHaveBeenCalled()
  })

  test('sends the descriptive User-Agent Wikimedia requires', async () => {
    http.get
      .mockResolvedValueOnce(entity())
      .mockResolvedValueOnce(commonsResponse('https://commons.test/Logo.svg'))

    await fetchWikidataBrandMeta('Q38076')

    // Without this Wikimedia answers 403.
    const headers = http.get.mock.calls[0][1].headers
    expect(headers['User-Agent']).toContain('Parchment/')
    expect(http.get.mock.calls[1][1].headers['User-Agent']).toContain('Parchment/')
  })

  test('requests only English for the default language', async () => {
    http.get.mockResolvedValueOnce(entity({ claims: {} }))

    await fetchWikidataBrandMeta('Q38076')

    expect(http.get.mock.calls[0][0]).toContain('languages=en')
  })

  test('requests the locale with an English fallback', async () => {
    http.get.mockResolvedValueOnce(entity({ claims: {} }))

    await fetchWikidataBrandMeta('Q38076', 'es')

    expect(http.get.mock.calls[0][0]).toContain('languages=es|en')
  })

  test('prefers the requested language description', async () => {
    http.get.mockResolvedValueOnce(
      ok({
        entities: {
          Q38076: {
            descriptions: {
              es: { value: 'Cadena de café' },
              en: { value: 'Coffee chain' },
            },
            claims: {},
          },
        },
      }),
    )

    const meta = await fetchWikidataBrandMeta('Q38076', 'es')

    expect(meta.description).toBe('Cadena de café')
  })

  test('falls back to the English description', async () => {
    http.get.mockResolvedValueOnce(
      ok({
        entities: {
          Q38076: {
            descriptions: { en: { value: 'Coffee chain' } },
            claims: {},
          },
        },
      }),
    )

    const meta = await fetchWikidataBrandMeta('Q38076', 'de')

    expect(meta.description).toBe('Coffee chain')
  })

  test('skips the Commons request when there is no logo claim', async () => {
    http.get.mockResolvedValueOnce(entity({ claims: {} }))

    const meta = await fetchWikidataBrandMeta('Q38076')

    expect(meta.logoUrl).toBeNull()
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  test('still returns the description when the logo lookup fails', async () => {
    http.get
      .mockResolvedValueOnce(entity())
      .mockResolvedValueOnce({ status: 500, data: {} })

    const meta = await fetchWikidataBrandMeta('Q38076')

    expect(meta.description).toBe('Coffee chain')
    expect(meta.logoUrl).toBeNull()
  })

  test('returns nulls for an unknown entity', async () => {
    http.get.mockResolvedValueOnce(ok({ entities: {} }))

    expect(await fetchWikidataBrandMeta('Q999999')).toEqual({
      logoUrl: null,
      description: null,
    })
  })

  test('swallows a network error', async () => {
    http.get.mockRejectedValueOnce(new Error('timeout'))

    expect(await fetchWikidataBrandMeta('Q38076')).toEqual({
      logoUrl: null,
      description: null,
    })
  })
})

describe('fetchWikidataBrandLogo', () => {
  test('resolves the P154 claim to a Commons URL', async () => {
    http.get
      .mockResolvedValueOnce(
        ok({
          entities: {
            Q38076: {
              claims: { P154: [{ mainsnak: { datavalue: { value: 'Logo.svg' } } }] },
            },
          },
        }),
      )
      .mockResolvedValueOnce(commonsResponse('https://commons.test/Logo.svg'))

    expect(await fetchWikidataBrandLogo('Q38076')).toBe(
      'https://commons.test/Logo.svg',
    )
  })

  test('returns null without an id', async () => {
    expect(await fetchWikidataBrandLogo(undefined)).toBeNull()
    expect(http.get).not.toHaveBeenCalled()
  })

  test('returns null when the entity has no logo claim', async () => {
    http.get.mockResolvedValueOnce(ok({ entities: { Q38076: { claims: {} } } }))

    expect(await fetchWikidataBrandLogo('Q38076')).toBeNull()
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  test('swallows a network error', async () => {
    http.get.mockRejectedValueOnce(new Error('ECONNRESET'))

    expect(await fetchWikidataBrandLogo('Q38076')).toBeNull()
  })
})
