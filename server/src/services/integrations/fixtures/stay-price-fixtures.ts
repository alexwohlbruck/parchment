import type { HotelCandidate, HotelPricesCapability, Stay } from '../../../types/integration.types'
import { adaptSerpCandidate, adaptSerpOffers, type SerpHotelsResponse } from '../adapters/serpapi-adapter'
import hotel from '../__fixtures__/serpapi-hotel.json'
import search from '../__fixtures__/serpapi-search.json'

/** Recorded Google Hotels answers, for development without a SerpApi key. Every hotel gets the same sellers. */
export const fixtureHotelPrices: HotelPricesCapability = {
  async searchHotels(_query: string, _stay: Stay) {
    const candidates = (search as SerpHotelsResponse).properties!
      .map(adaptSerpCandidate)
      .filter((c): c is HotelCandidate => !!c)
    return { candidates }
  },
  async getOffers(_token: string, stay: Stay) {
    return adaptSerpOffers(hotel as SerpHotelsResponse, stay.currency)
  },
}

/** Fixture prices are a development aid: never on outside `NODE_ENV=development`. */
export function stayPriceFixturesEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.STAY_PRICE_FIXTURES === '1'
}
