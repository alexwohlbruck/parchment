import type { Place } from '../../types/place.types'
import { distance, point } from '@turf/turf'
import { isOpenAt } from '../opening-hours'

/** What the model sees of a place: enough to judge it, small enough to list dozens. */
export interface PlaceSummary {
  id: string
  name: string
  type?: string
  address?: string
  lat: number
  lng: number
  distanceM?: number
  openNow?: boolean
  hours?: string
  closed?: 'permanently' | 'temporarily'
  rating?: number
  reviewCount?: number
  summary?: string
}

export interface PlaceDetail extends PlaceSummary {
  description?: string
  website?: string
  phone?: string
  amenities?: Record<string, string | boolean | number>
  reviews?: { text: string; rating?: number; date?: string }[]
}

const MAX_REVIEWS = 5
const MAX_REVIEW_CHARS = 300

export function openNow(place: Place, now: Date): boolean | undefined {
  const hours = place.openingHours?.value
  if (!hours) return undefined
  if (hours.isPermanentlyClosed || hours.isTemporarilyClosed) return false
  if (hours.isOpen24_7) return true
  const center = place.geometry.value.center
  return (
    isOpenAt(
      hours.rawText,
      { timezone: place.timezone, lat: center.lat, lng: center.lng },
      now,
    ) ?? undefined
  )
}

function formatAddress(place: Place): string | undefined {
  const address = place.address?.value
  if (!address) return undefined
  return (
    address.formatted ||
    [address.street1, address.locality].filter(Boolean).join(', ') ||
    undefined
  )
}

export function summarizePlace(
  place: Place,
  context: { now: Date; origin?: { lat: number; lng: number } },
): PlaceSummary {
  const center = place.geometry.value.center
  const hours = place.openingHours?.value
  const closed = hours?.isPermanentlyClosed
    ? 'permanently'
    : hours?.isTemporarilyClosed
      ? 'temporarily'
      : undefined

  return dropEmpty({
    id: place.id,
    name: place.name.value ?? 'Unnamed place',
    type: place.placeType?.value,
    address: formatAddress(place),
    lat: round(center.lat),
    lng: round(center.lng),
    distanceM: context.origin
      ? Math.round(distance(point([context.origin.lng, context.origin.lat]), point([center.lng, center.lat]), { units: 'meters' }))
      : undefined,
    openNow: openNow(place, context.now),
    hours: hours?.rawText,
    closed,
    rating: place.ratings?.rating.value,
    reviewCount: place.ratings?.reviewCount.value,
    summary: place.summary ?? undefined,
  })
}

export function describePlace(
  place: Place,
  context: { now: Date; origin?: { lat: number; lng: number } },
): PlaceDetail {
  const amenities = Object.fromEntries(
    Object.entries(place.amenities ?? {}).map(([key, { value }]) => [key, value]),
  )
  return dropEmpty({
    ...summarizePlace(place, context),
    description: place.description?.value,
    website: place.contactInfo?.website?.value,
    phone: place.contactInfo?.phone?.value,
    amenities: Object.keys(amenities).length ? amenities : undefined,
    reviews: place.reviews?.length
      ? place.reviews.slice(0, MAX_REVIEWS).map(({ value }) =>
          dropEmpty({
            text: value.text.slice(0, MAX_REVIEW_CHARS),
            rating: value.rating,
            date: value.createdAt?.slice(0, 10),
          }),
        )
      : undefined,
  })
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5
}

function dropEmpty<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as T
}
