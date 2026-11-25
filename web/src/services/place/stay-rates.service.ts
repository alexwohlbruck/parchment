import { api } from '@/lib/api'
import type { StayRates } from '@server/types/integration.types'

export interface StayRatesQuery {
  source: string
  id: string
  checkin: string
  checkout: string
  adults: number
  currency: string
  nationality: string
}

export async function fetchStayRates(query: StayRatesQuery, signal: AbortSignal): Promise<StayRates | null> {
  const { data } = await api.get<{ rates: StayRates | null }>('/places/stay-rates', {
    params: query,
    signal,
    timeout: 20_000,
  })
  return data.rates
}
