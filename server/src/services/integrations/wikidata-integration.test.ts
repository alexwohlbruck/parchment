/**
 * Unit tests for the Wikidata integration.
 *
 * Wikidata needs no credentials, so `validateConfig` is unconditionally true —
 * the risk is the opposite of the usual one: nothing stops an operator from
 * enabling it, so the failure surface is entirely in `testConnection` and the
 * entity fetch.
 *
 * The three extractors resolve the cross-wiki links that drive enrichment:
 * `sitelinks[<lang>wiki]` for the Wikipedia article, P373 for the Commons
 * category and P935 for the gallery. A wrong property code silently yields no
 * photos, which looks like "this place has none" rather than an error.
 *
 * Wikimedia rejects requests without a descriptive User-Agent, so the headers
 * are asserted on every call.
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

const { WikidataIntegration } = await import('./wikidata-integration')

/** An initialized integration. */
function configured() {
  const integration = new WikidataIntegration()
  integration.initialize({} as any)
  return integration
}

const entityResponse = (id: string, entity: unknown) => ({
  data: { entities: { [id]: entity } },
})

beforeEach(() => {
  http.reset()
})

describe('configuration', () => {
  test('needs no credentials', () => {
    expect(new WikidataIntegration().validateConfig({} as any)).toBe(true)
  })

  test('declares the Wikidata source', () => {
    expect(new WikidataIntegration().sources).toEqual(['wikidata'])
  })

  test('refuses to fetch before initialization', async () => {
    await expect(
      new WikidataIntegration().getEntityData('Q42'),
    ).rejects.toThrow('has not been initialized')
    expect(http.get).not.toHaveBeenCalled()
  })
})

describe('testConnection', () => {
  test('probes a well-known entity', async () => {
    http.get.mockResolvedValueOnce(entityResponse('Q2', { id: 'Q2' }))

    const result = await new WikidataIntegration().testConnection({} as any)

    expect(result).toEqual({ success: true })
    expect(http.get.mock.calls[0][0]).toContain('Special:EntityData/Q2.json')
  })

  test('sends the descriptive User-Agent Wikimedia requires', async () => {
    http.get.mockResolvedValueOnce(entityResponse('Q2', { id: 'Q2' }))

    await new WikidataIntegration().testConnection({} as any)

    // Without one, Wikimedia answers 403.
    expect(http.get.mock.calls[0][1].headers['User-Agent']).toBeDefined()
  })

  test('fails when the response shape is unexpected', async () => {
    http.get.mockResolvedValueOnce({ data: { entities: {} } })

    const result = await new WikidataIntegration().testConnection({} as any)

    expect(result).toEqual({
      success: false,
      message: 'Invalid response format from Wikidata API',
    })
  })

  test('fails when the body is empty', async () => {
    http.get.mockResolvedValueOnce({ data: null })

    expect(
      (await new WikidataIntegration().testConnection({} as any)).success,
    ).toBe(false)
  })

  test('surfaces a network failure message', async () => {
    http.get.mockRejectedValueOnce(new Error('ETIMEDOUT'))

    const result = await new WikidataIntegration().testConnection({} as any)

    expect(result.success).toBe(false)
    expect(result.message).toBe('ETIMEDOUT')
  })

  test('bounds the probe with a timeout', async () => {
    http.get.mockResolvedValueOnce(entityResponse('Q2', { id: 'Q2' }))

    await new WikidataIntegration().testConnection({} as any)

    expect(http.get.mock.calls[0][1].timeout).toBe(10000)
  })
})

describe('getEntityData', () => {
  test('returns the entity for the requested id', async () => {
    http.get.mockResolvedValueOnce(
      entityResponse('Q42', { id: 'Q42', labels: {} }),
    )

    const entity = await configured().getEntityData('Q42')

    expect(entity).toMatchObject({ id: 'Q42' })
    expect(http.get.mock.calls[0][0]).toContain('Special:EntityData/Q42.json')
  })

  test('defaults the language to English', async () => {
    http.get.mockResolvedValueOnce(entityResponse('Q42', {}))

    await configured().getEntityData('Q42')

    expect(http.get.mock.calls[0][1].headers['Accept-Language']).toBe('en')
  })

  test('passes an explicit language through', async () => {
    http.get.mockResolvedValueOnce(entityResponse('Q42', {}))

    await configured().getEntityData('Q42', 'de')

    expect(http.get.mock.calls[0][1].headers['Accept-Language']).toBe('de')
  })

  test('returns null when the entity is absent from the payload', async () => {
    http.get.mockResolvedValueOnce({ data: { entities: {} } })

    expect(await configured().getEntityData('Q999999')).toBeNull()
  })

  test('returns null rather than throwing on a network failure', async () => {
    // Enrichment is optional; a Wikidata outage must not fail a place lookup.
    http.get.mockRejectedValueOnce(new Error('ECONNRESET'))

    expect(await configured().getEntityData('Q42')).toBeNull()
  })

  test('uses a longer timeout than the connection probe', async () => {
    http.get.mockResolvedValueOnce(entityResponse('Q42', {}))

    await configured().getEntityData('Q42')

    expect(http.get.mock.calls[0][1].timeout).toBe(15000)
  })
})

describe('extractWikipediaTitle', () => {
  const integration = new WikidataIntegration()

  test('resolves the article title for a language', () => {
    const entity = {
      sitelinks: {
        enwiki: { title: 'Bank of America Stadium' },
        dewiki: { title: 'Bank of America Stadium (Charlotte)' },
      },
    }

    expect(integration.extractWikipediaTitle(entity)).toBe(
      'Bank of America Stadium',
    )
    expect(integration.extractWikipediaTitle(entity, 'de')).toBe(
      'Bank of America Stadium (Charlotte)',
    )
  })

  test('returns null when that language has no article', () => {
    const entity = { sitelinks: { enwiki: { title: 'Something' } } }

    expect(integration.extractWikipediaTitle(entity, 'ja')).toBeNull()
  })

  test('returns null when the entity has no sitelinks', () => {
    expect(integration.extractWikipediaTitle({})).toBeNull()
    expect(integration.extractWikipediaTitle(null)).toBeNull()
  })
})

describe('Commons link extraction', () => {
  const integration = new WikidataIntegration()
  const claim = (value: unknown) => ({ mainsnak: { datavalue: { value } } })

  test('reads the Commons category from P373', () => {
    const entity = { claims: { P373: [claim('Bank of America Stadium')] } }

    expect(integration.extractCommonsCategory(entity)).toBe(
      'Bank of America Stadium',
    )
  })

  test('reads the Commons gallery from P935', () => {
    const entity = { claims: { P935: [claim('Charlotte')] } }

    expect(integration.extractCommonsGallery(entity)).toBe('Charlotte')
  })

  test('returns null when the property is absent', () => {
    expect(integration.extractCommonsCategory({ claims: {} })).toBeNull()
    expect(integration.extractCommonsGallery({ claims: {} })).toBeNull()
  })

  test('returns null for an empty claim list', () => {
    expect(integration.extractCommonsCategory({ claims: { P373: [] } })).toBeNull()
  })

  test('returns null when the entity has no claims at all', () => {
    expect(integration.extractCommonsCategory({})).toBeNull()
    expect(integration.extractCommonsGallery(null)).toBeNull()
  })

  test('uses the first claim when several exist', () => {
    const entity = {
      claims: { P373: [claim('First Category'), claim('Second Category')] },
    }

    expect(integration.extractCommonsCategory(entity)).toBe('First Category')
  })

  test('does not confuse the category and gallery properties', () => {
    // P373 vs P935 — swapping them yields a wrong Commons target.
    const entity = { claims: { P373: [claim('A Category')] } }

    expect(integration.extractCommonsGallery(entity)).toBeNull()
  })
})
