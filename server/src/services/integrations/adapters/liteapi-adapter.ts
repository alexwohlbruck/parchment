import type { HotelCandidate, StayMoney, StayRoom } from '../../../types/integration.types'

export interface LiteApiHotel {
  id: string
  name: string
  latitude: number
  longitude: number
  address?: string
  city?: string
}

export interface LiteApiHotelDetail {
  id: string
  name: string
  address?: string
  city?: string
  location?: { latitude: number; longitude: number }
}

function hotelAddress(hotel: { address?: string; city?: string }): string | null {
  return [hotel.address, hotel.city].filter(Boolean).join(', ') || null
}

export function adaptLiteApiHotel(hotel: LiteApiHotel): HotelCandidate {
  return { id: hotel.id, name: hotel.name, lat: hotel.latitude, lng: hotel.longitude, address: hotelAddress(hotel) }
}

export function adaptLiteApiHotelDetail(hotel: LiteApiHotelDetail): HotelCandidate {
  return {
    id: hotel.id,
    name: hotel.name,
    lat: hotel.location?.latitude ?? NaN,
    lng: hotel.location?.longitude ?? NaN,
    address: hotelAddress(hotel),
  }
}

interface LiteApiAmount {
  amount: number
  currency: string
}

interface LiteApiRate {
  name: string
  boardName?: string
  boardType?: string
  retailRate?: {
    taxesAndFees?: { included: boolean; amount: number; currency: string }[] | null
  }
  cancellationPolicies?: {
    refundableTag?: string
    cancelPolicyInfos?: { cancelTime: string; timezone?: string }[]
  }
}

export interface LiteApiRoomType {
  offerId: string
  rates: LiteApiRate[]
  offerRetailRate: LiteApiAmount
  suggestedSellingPrice?: LiteApiAmount | null
}

const MAX_ROOMS = 4

/** Selling publicly below the hotel's suggested price breaks rate parity, so never show less than it. */
function sellingPrice(room: LiteApiRoomType): StayMoney {
  const retail = room.offerRetailRate
  const suggested = room.suggestedSellingPrice
  if (suggested && suggested.currency === retail.currency && suggested.amount > retail.amount) {
    return { amount: suggested.amount, currency: suggested.currency }
  }
  return { amount: retail.amount, currency: retail.currency }
}

function payAtProperty(rates: LiteApiRate[]): StayMoney | null {
  const fees = rates.flatMap((rate) => rate.retailRate?.taxesAndFees ?? []).filter((fee) => !fee.included)
  if (!fees.length) return null
  return {
    amount: Math.round(fees.reduce((sum, fee) => sum + fee.amount, 0) * 100) / 100,
    currency: fees[0].currency,
  }
}

function toIsoUtc(cancelTime: string): string | null {
  const date = new Date(`${cancelTime.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** When a rate stops being free to cancel: the first penalty's start, or null for non-refundable rates. */
function freeCancellationUntil(rate: LiteApiRate | undefined): string | null {
  const policies = rate?.cancellationPolicies
  if (policies?.refundableTag !== 'RFN') return null
  const first = policies.cancelPolicyInfos
    ?.map((info) => toIsoUtc(info.cancelTime))
    .filter((t): t is string => !!t)
    .sort()[0]
  return first ?? null
}

function board(rate: LiteApiRate | undefined): string | null {
  if (!rate?.boardName || rate.boardType === 'RO') return null
  return rate.boardName
}

/** The cheapest offer for each room, cheapest first. */
export function adaptLiteApiRooms(
  roomTypes: LiteApiRoomType[],
  checkoutUrl: (offerId: string) => string,
): StayRoom[] {
  const cheapestByName = new Map<string, StayRoom>()
  for (const roomType of roomTypes) {
    const rate = roomType.rates[0]
    if (!rate?.name || !roomType.offerRetailRate) continue
    const room: StayRoom = {
      offerId: roomType.offerId,
      name: rate.name.trim(),
      total: sellingPrice(roomType),
      payAtProperty: payAtProperty(roomType.rates),
      board: board(rate),
      freeCancellationUntil: freeCancellationUntil(rate),
      bookingUrl: checkoutUrl(roomType.offerId),
    }
    const key = room.name.toLowerCase()
    const existing = cheapestByName.get(key)
    if (!existing || room.total.amount < existing.total.amount) cheapestByName.set(key, room)
  }
  return [...cheapestByName.values()]
    .sort((a, b) => a.total.amount - b.total.amount)
    .slice(0, MAX_ROOMS)
}

export function liteApiCheckoutUrl(whitelabelUrl: string, offerId: string): string {
  const url = new URL('/booking', whitelabelUrl)
  url.searchParams.set('offerId', offerId)
  return url.toString()
}

export function liteApiHotelUrl(
  whitelabelUrl: string,
  hotelId: string,
  stay: { checkin: string; checkout: string; adults: number },
): string {
  const url = new URL(`/hotels/${encodeURIComponent(hotelId)}`, whitelabelUrl)
  url.searchParams.set('checkin', stay.checkin)
  url.searchParams.set('checkout', stay.checkout)
  url.searchParams.set('occupancies', btoa(JSON.stringify([{ adults: stay.adults, children: [] }])))
  return url.toString()
}
