import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import rates from './__fixtures__/liteapi-rates.json'

const realFetch = globalThis.fetch
let responses: Response[] = []
const calls: { url: string; init?: RequestInit }[] = []

globalThis.fetch = mock(async (url: any, init?: any) => {
  calls.push({ url: String(url), init })
  return responses.shift() ?? new Response('{}', { status: 200 })
}) as any

afterAll(() => {
  globalThis.fetch = realFetch
})

const { LiteApiIntegration } = await import('./liteapi-integration')

const config = { apiKey: 'sand_test', whitelabelUrl: 'https://stay.example.com' }
const request = {
  hotelId: 'lp1897',
  checkin: '2026-11-25',
  checkout: '2026-11-26',
  adults: 2,
  currency: 'USD',
  guestNationality: 'US',
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

function integration() {
  const instance = new LiteApiIntegration()
  instance.initialize(config)
  return instance.capabilities.hotelRates!
}

beforeEach(() => {
  responses = []
  calls.length = 0
})

describe('LiteApiIntegration', () => {
  test('requires a key and an https white-label site', () => {
    const instance = new LiteApiIntegration()
    expect(instance.validateConfig(config)).toBe(true)
    expect(instance.validateConfig({ ...config, whitelabelUrl: 'http://stay.example.com' })).toBe(false)
    expect(instance.validateConfig({ ...config, apiKey: ' ' })).toBe(false)
  })

  test('prices the hotel for the stay and links each room to its offer', async () => {
    responses = [json(rates)]
    const result = await integration().getStayRates(request)

    expect(new URL(calls[0].url).pathname).toBe('/v3.0/hotels/rates')
    expect((calls[0].init?.headers as Record<string, string>)['X-API-Key']).toBe('sand_test')
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      hotelIds: ['lp1897'],
      occupancies: [{ adults: 2 }],
      checkin: '2026-11-25',
      checkout: '2026-11-26',
      currency: 'USD',
      guestNationality: 'US',
    })
    expect(result.rooms[0].bookingUrl).toBe('https://stay.example.com/booking?offerId=offer-king-nr')
    expect(result.bookingUrl).toStartWith('https://stay.example.com/hotels/lp1897?checkin=2026-11-25')
  })

  test('a sold-out stay has no rooms but still links the hotel', async () => {
    responses = [json({ error: { code: 2001, description: 'no availability found' } })]
    const result = await integration().getStayRates(request)
    expect(result.rooms).toEqual([])
    expect(result.bookingUrl).toContain('/hotels/lp1897')
  })

  test('surfaces an upstream failure', async () => {
    responses = [new Response('nope', { status: 500 })]
    await expect(integration().getStayRates(request)).rejects.toThrow('LiteAPI /hotels/rates: 500')
  })
})
