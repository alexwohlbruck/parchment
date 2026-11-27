import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import hotel from './__fixtures__/serpapi-hotel.json'
import search from './__fixtures__/serpapi-search.json'

const realFetch = globalThis.fetch
let responses: Response[] = []
const calls: string[] = []
globalThis.fetch = mock(async (url: any) => {
  calls.push(String(url))
  return responses.shift() ?? new Response('{}')
}) as any
afterAll(() => {
  globalThis.fetch = realFetch
})

const { SerpApiIntegration } = await import('./serpapi-integration')

const stay = { checkin: '2026-11-25', checkout: '2026-11-26', adults: 2, currency: 'USD', guestNationality: 'US' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function prices() {
  const integration = new SerpApiIntegration()
  integration.initialize({ apiKey: 'serp_test' })
  return integration.capabilities.hotelPrices!
}

beforeEach(() => {
  responses = []
  calls.length = 0
})

describe('SerpApiIntegration', () => {
  test('prices a hotel by its property token for the stay', async () => {
    responses = [json(hotel)]
    const offers = await prices().getOffers('ChoIp8', stay)
    const params = new URL(calls[0]).searchParams
    expect(Object.fromEntries(params)).toMatchObject({
      engine: 'google_hotels',
      property_token: 'ChoIp8',
      check_in_date: '2026-11-25',
      check_out_date: '2026-11-26',
      adults: '2',
      currency: 'USD',
      gl: 'us',
      api_key: 'serp_test',
    })
    expect(offers).toHaveLength(4)
  })

  test('returns the candidates of a hotel search', async () => {
    responses = [json(search)]
    const found = await prices().searchHotels('EVEN Hotel Brooklyn, Brooklyn', stay)
    expect(found.candidates.map((c) => c.id)).toEqual(['ChoIp8bW2tGU-6vDARoNL2cvMTFmMHR0Z2ZzdBAB', 'ChgIindigo', 'ChgIfar'])
    expect(found.property).toBeUndefined()
  })

  test('keeps the prices when Google resolves the search to one hotel', async () => {
    responses = [json(hotel)]
    const found = await prices().searchHotels('EVEN Hotel Brooklyn', stay)
    expect(found.candidates).toHaveLength(1)
    expect(found.property?.offers[0].seller).toBe('EVEN Hotel Brooklyn by IHG')
  })

  test('reads "no results" as empty, and any other error as a failure', async () => {
    responses = [json({ error: "Google Hotels hasn't returned any results for this query." })]
    expect(await prices().searchHotels('Nowhere', stay)).toEqual({ candidates: [] })
    responses = [json({ error: 'Your account has run out of searches.' }, 429)]
    await expect(prices().getOffers('tok', stay)).rejects.toThrow('run out of searches')
  })
})
