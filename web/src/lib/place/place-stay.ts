import type { BookingKind } from '@/lib/place/place-booking'
import { addDays, localDay } from '@/lib/offline/expiry'

/** Who is going and when. A stay lasts `nights`; a table ignores it. */
export interface BookingPlan {
  party: number
  /** Local day, YYYY-MM-DD. */
  day: string
  nights: number
}

export const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8]
export const STAY_NIGHTS = [1, 2, 3, 4, 5, 6, 7, 10, 14]
const DAYS_AHEAD = 14

const EURO_REGIONS = new Set(
  'AT BE HR CY EE FI FR DE GR IE IT LV LT LU MT NL PT SK SI ES'.split(' '),
)
const REGION_CURRENCIES: Record<string, string> = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', MX: 'MXN', JP: 'JPY',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', BR: 'BRL', AR: 'ARS', CO: 'COP', CL: 'CLP',
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addNights(day: string, nights: number): string {
  return localDay(addDays(parseDay(day), nights))
}

/** Two people, tonight, one night: the booking most people make. */
export function defaultPlan(now = new Date()): BookingPlan {
  return { party: 2, day: localDay(now), nights: 1 }
}

export function upcomingDays(now = new Date()): string[] {
  const today = localDay(now)
  return Array.from({ length: DAYS_AHEAD }, (_, i) => addNights(today, i))
}

/** The guest's currency and country, from the app locale's region. */
export function guestMarket(locale: string): { currency: string; nationality: string } {
  const region = locale.split(/[-_]/)[1]?.toUpperCase() ?? 'US'
  const currency = EURO_REGIONS.has(region) ? 'EUR' : (REGION_CURRENCIES[region] ?? 'USD')
  return { currency, nationality: /^[A-Z]{2}$/.test(region) ? region : 'US' }
}

/** Dinner time on the chosen day, or the next half hour when that has passed. */
export function tableTime(day: string, now = new Date()): string {
  let at = new Date(parseDay(day))
  at.setHours(19, 0, 0, 0)
  if (at < now) {
    at = new Date(now)
    at.setMinutes(at.getMinutes() < 30 ? 30 : 60, 0, 0)
  }
  return `${localDay(at)}T${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

export function dayLabelKey(day: string, kind: BookingKind, now = new Date()): 'tonight' | 'today' | 'tomorrow' | null {
  const today = localDay(now)
  if (day === today) return kind === 'stay' || kind === 'table' ? 'tonight' : 'today'
  if (day === addNights(today, 1)) return 'tomorrow'
  return null
}
