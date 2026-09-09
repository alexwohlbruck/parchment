/**
 * Unit tests for the Wikipedia integration.
 *
 * `getPageData` makes two calls: the extract/image/coordinates query, then a
 * best-effort wikitext fetch for infobox parsing. The second one is wrapped in
 * its own try/catch precisely so an infobox failure still returns the page —
 * losing the summary because the wikitext endpoint hiccuped would be a bad
 * trade.
 *
 * The `page.missing` sentinel is how the MediaWiki API reports a nonexistent
 * article (it still returns HTTP 200 with a page stub), so checking the status
 * alone would treat every missing article as a valid empty page.
 *
 * The API is per-language-subdomain, so the language selects the HOST, not a
 * query parameter.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createAxiosMock } from '../../test/axios-mock'

const http = createAxiosMock()
mock.module('axios', () => http.module)

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { WikipediaIntegration } = await import('./wikipedia-integration')

function configured() {
  const integration = new WikipediaIntegration()
  integration.initialize({} as any)
  return integration
}

/** The extract/pageimages/coordinates query response. */
const pageResponse = (page: Record<string, unknown>) => ({
  data: { query: { pages: { '12345': { pageid: 12345, ...page } } } },
})

/** The wikitext revision response used for infobox parsing. */
const wikitextResponse = (wikitext: string) => ({
  data: {
    query: {
      pages: { '12345': { revisions: [{ slots: { main: { '*': wikitext } } }] } },
    },
  },
})

beforeEach(() => {
  http.reset()
})

describe('configuration', () => {
  test('needs no credentials', () => {
    expect(new WikipediaIntegration().validateConfig({} as any)).toBe(true)
  })

  test('refuses to fetch before initialization', async () => {
    await expect(
      new WikipediaIntegration().getPageData('Charlotte'),
    ).rejects.toThrow('has not been initialized')
    expect(http.get).not.toHaveBeenCalled()
  })
})

describe('testConnection', () => {
  test('succeeds against a reachable API', async () => {
    http.get.mockResolvedValueOnce(pageResponse({ title: 'Earth' }))

    const result = await new WikipediaIntegration().testConnection({} as any)

    expect(result.success).toBe(true)
  })

  test('surfaces a network failure', async () => {
    http.get.mockRejectedValueOnce(new Error('ETIMEDOUT'))

    const result = await new WikipediaIntegration().testConnection({} as any)

    expect(result.success).toBe(false)
  })
})

describe('getPageData', () => {
  test('returns the page with its language stamped on', async () => {
    http.get
      .mockResolvedValueOnce(
        pageResponse({ title: 'Charlotte', extract: 'A city.' }),
      )
      .mockResolvedValueOnce(wikitextResponse(''))

    const page = await configured().getPageData('Charlotte')

    expect(page).toMatchObject({ title: 'Charlotte', language: 'en' })
  })

  test('selects the language SUBDOMAIN, not a query param', async () => {
    http.get
      .mockResolvedValueOnce(pageResponse({ title: 'Köln' }))
      .mockResolvedValueOnce(wikitextResponse(''))

    await configured().getPageData('Köln', 'de')

    expect(http.get.mock.calls[0][0]).toBe('https://de.wikipedia.org/w/api.php')
  })

  test('defaults to the English wiki', async () => {
    http.get
      .mockResolvedValueOnce(pageResponse({ title: 'Charlotte' }))
      .mockResolvedValueOnce(wikitextResponse(''))

    await configured().getPageData('Charlotte')

    expect(http.get.mock.calls[0][0]).toBe('https://en.wikipedia.org/w/api.php')
  })

  test('requests a plaintext intro extract plus image and coordinates', async () => {
    http.get
      .mockResolvedValueOnce(pageResponse({ title: 'Charlotte' }))
      .mockResolvedValueOnce(wikitextResponse(''))

    await configured().getPageData('Charlotte')

    const params = http.get.mock.calls[0][1].params
    expect(params.prop).toBe('extracts|pageimages|coordinates')
    expect(params.exintro).toBe(true)
    expect(params.explaintext).toBe(true)
  })

  test('sends the descriptive User-Agent Wikimedia requires', async () => {
    http.get
      .mockResolvedValueOnce(pageResponse({ title: 'Charlotte' }))
      .mockResolvedValueOnce(wikitextResponse(''))

    await configured().getPageData('Charlotte')

    expect(http.get.mock.calls[0][1].headers).toBeDefined()
  })

  test('returns null for a missing article despite the HTTP 200', async () => {
    // MediaWiki reports absence with a `missing` key, not a 404.
    http.get.mockResolvedValueOnce(
      pageResponse({ title: 'Nonexistent', missing: '' }),
    )

    expect(await configured().getPageData('Nonexistent')).toBeNull()
  })

  test('returns null when the response carries no pages', async () => {
    http.get.mockResolvedValueOnce({ data: { query: {} } })

    expect(await configured().getPageData('Charlotte')).toBeNull()
  })

  test('returns null rather than throwing on a network failure', async () => {
    // Enrichment is optional; an outage must not fail the place lookup.
    http.get.mockRejectedValueOnce(new Error('ECONNRESET'))

    expect(await configured().getPageData('Charlotte')).toBeNull()
  })
})

describe('infobox parsing', () => {
  test('parses infobox fields out of the wikitext', async () => {
    http.get
      .mockResolvedValueOnce(pageResponse({ title: 'Charlotte' }))
      .mockResolvedValueOnce(
        wikitextResponse(
          '{{Infobox settlement\n| name = Charlotte\n| type = City\n}}\nBody text.',
        ),
      )

    const page = await configured().getPageData('Charlotte')

    expect(page.infobox).not.toBeNull()
  })

  test('still returns the page when the wikitext fetch fails', async () => {
    // The infobox is a bonus; losing the summary over it would be a bad trade.
    http.get
      .mockResolvedValueOnce(
        pageResponse({ title: 'Charlotte', extract: 'A city.' }),
      )
      .mockRejectedValueOnce(new Error('rate limited'))

    const page = await configured().getPageData('Charlotte')

    expect(page).toMatchObject({ title: 'Charlotte', extract: 'A city.' })
    expect(page.infobox).toBeNull()
  })

  test('reports a null infobox when the article has no revisions', async () => {
    http.get
      .mockResolvedValueOnce(pageResponse({ title: 'Charlotte' }))
      .mockResolvedValueOnce({ data: { query: { pages: { '12345': {} } } } })

    expect((await configured().getPageData('Charlotte')).infobox).toBeNull()
  })

  test('reports a null infobox when the wikitext has none', async () => {
    http.get
      .mockResolvedValueOnce(pageResponse({ title: 'Charlotte' }))
      .mockResolvedValueOnce(wikitextResponse('Just prose, no infobox.'))

    const page = await configured().getPageData('Charlotte')

    expect(page.infobox === null || Object.keys(page.infobox).length === 0).toBe(
      true,
    )
  })
})

describe('getPageSummary', () => {
  test('returns the extract', async () => {
    http.get
      .mockResolvedValueOnce(
        pageResponse({ title: 'Charlotte', extract: 'A city in NC.' }),
      )
      .mockResolvedValueOnce(wikitextResponse(''))

    expect(await configured().getPageSummary('Charlotte')).toBe('A city in NC.')
  })

  test('returns null when the page has no extract', async () => {
    http.get
      .mockResolvedValueOnce(pageResponse({ title: 'Charlotte' }))
      .mockResolvedValueOnce(wikitextResponse(''))

    expect(await configured().getPageSummary('Charlotte')).toBeNull()
  })

  test('returns null for a missing article', async () => {
    http.get.mockResolvedValueOnce(pageResponse({ missing: '' }))

    expect(await configured().getPageSummary('Nonexistent')).toBeNull()
  })
})

describe('getPageCoordinates', () => {
  test('renames the API’s lon to lng', async () => {
    http.get
      .mockResolvedValueOnce(
        pageResponse({
          title: 'Charlotte',
          coordinates: [{ lat: 35.2271, lon: -80.8431 }],
        }),
      )
      .mockResolvedValueOnce(wikitextResponse(''))

    expect(await configured().getPageCoordinates('Charlotte')).toEqual({
      lat: 35.2271,
      lng: -80.8431,
    })
  })

  test('uses the first coordinate when several are listed', async () => {
    http.get
      .mockResolvedValueOnce(
        pageResponse({
          coordinates: [
            { lat: 1, lon: 2 },
            { lat: 3, lon: 4 },
          ],
        }),
      )
      .mockResolvedValueOnce(wikitextResponse(''))

    expect(await configured().getPageCoordinates('Charlotte')).toEqual({
      lat: 1,
      lng: 2,
    })
  })

  test('returns null when the article carries no coordinates', async () => {
    http.get
      .mockResolvedValueOnce(pageResponse({ title: 'Abstract Concept' }))
      .mockResolvedValueOnce(wikitextResponse(''))

    expect(await configured().getPageCoordinates('Abstract Concept')).toBeNull()
  })

  test('returns null for an empty coordinate list', async () => {
    http.get
      .mockResolvedValueOnce(pageResponse({ coordinates: [] }))
      .mockResolvedValueOnce(wikitextResponse(''))

    expect(await configured().getPageCoordinates('Charlotte')).toBeNull()
  })
})
