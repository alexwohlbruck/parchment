import { describe, expect, test } from 'bun:test'
import rates from '../__fixtures__/liteapi-rates.json'
import {
  adaptLiteApiRooms,
  liteApiCheckoutUrl,
  liteApiHotelUrl,
  type LiteApiRoomType,
} from './liteapi-adapter'

const roomTypes = rates.data[0].roomTypes as unknown as LiteApiRoomType[]
const checkout = (offerId: string) => `https://book.example/booking?offerId=${offerId}`

describe('adaptLiteApiRooms', () => {
  const rooms = adaptLiteApiRooms(roomTypes, checkout)

  test('keeps the cheapest offer per room, cheapest first', () => {
    expect(rooms.map((r) => [r.name, r.offerId])).toEqual([
      ['Standard King Room', 'offer-king-nr'],
      ['Superior Queen Room', 'offer-queen-bb'],
    ])
  })

  test('never shows less than the suggested selling price', () => {
    const flex = adaptLiteApiRooms([roomTypes[0]], checkout)[0]
    expect(flex.total).toEqual({ amount: 191.52, currency: 'USD' })
    expect(rooms[1].total).toEqual({ amount: 182.4, currency: 'USD' })
  })

  test('sums the fees paid at the property', () => {
    expect(adaptLiteApiRooms([roomTypes[0]], checkout)[0].payAtProperty).toEqual({ amount: 43.61, currency: 'USD' })
    expect(rooms[0].payAtProperty).toBeNull()
  })

  test('reads free cancellation only from refundable rates', () => {
    expect(adaptLiteApiRooms([roomTypes[0]], checkout)[0].freeCancellationUntil).toBe('2026-12-03T02:00:00.000Z')
    expect(rooms[0].freeCancellationUntil).toBeNull()
  })

  test('names the meal plan unless it is room only', () => {
    expect(rooms[0].board).toBeNull()
    expect(rooms[1].board).toBe('Bed and Breakfast')
  })

  test('links each room to checkout for its own offer', () => {
    expect(rooms[1].bookingUrl).toBe(checkout('offer-queen-bb'))
  })
})

describe('white-label links', () => {
  test('checkout carries the offer id', () => {
    expect(liteApiCheckoutUrl('https://stay.example.com', 'abc 1')).toBe('https://stay.example.com/booking?offerId=abc+1')
  })

  test('hotel page carries the dates and guests', () => {
    const url = new URL(liteApiHotelUrl('https://stay.example.com', 'lp1897', { checkin: '2026-11-25', checkout: '2026-11-26', adults: 2 }))
    expect(url.pathname).toBe('/hotels/lp1897')
    expect(url.searchParams.get('checkin')).toBe('2026-11-25')
    expect(JSON.parse(atob(url.searchParams.get('occupancies')!))).toEqual([{ adults: 2, children: [] }])
  })
})
