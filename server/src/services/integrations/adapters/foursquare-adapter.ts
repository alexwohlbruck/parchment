import type {
  Place,
  PlacePhoto,
  AttributedValue,
  Address,
  OpeningHours,
  OpeningTime,
} from '../../../types/place.types'
import { SOURCE } from '../../../lib/constants'

/**
 * Raw shape of a place from the Foursquare Places API (v2025-06-17).
 *
 * All enrichment fields (hours/rating/price/photos/tips/stats) are Premium
 * and only present when explicitly requested via the `fields` param — so
 * every one is optional. Lean search responses carry only the core fields.
 */
export interface FoursquarePlace {
  fsq_place_id: string
  name?: string
  latitude?: number
  longitude?: number
  location?: {
    address?: string
    locality?: string
    region?: string
    postcode?: string
    country?: string
    formatted_address?: string
  }
  categories?: Array<{
    fsq_category_id?: string
    id?: string
    name?: string
    icon?: { prefix?: string; suffix?: string }
  }>
  tel?: string
  website?: string
  email?: string
  social_media?: {
    facebook_id?: string
    instagram?: string
    twitter?: string
  }
  hours?: {
    display?: string
    open_now?: boolean
    regular?: Array<{ day: number; open: string; close: string }>
  }
  /** 0.0 – 10.0 */
  rating?: number
  /** 1 (cheap) – 4 (very expensive) */
  price?: number
  photos?: Array<{
    id?: string
    prefix?: string
    suffix?: string
    width?: number
    height?: number
  }>
  tips?: Array<{ text?: string }>
  stats?: {
    total_photos?: number
    total_ratings?: number
    total_tips?: number
  }
}

const attr = <T>(value: T): AttributedValue<T> => ({
  value,
  sourceId: SOURCE.FOURSQUARE,
})

/**
 * Adapter transforming Foursquare Places API responses into the unified
 * `Place` schema. Every value is attributed to `SOURCE.FOURSQUARE` so the
 * merge layer can weigh it against other providers by source priority.
 */
export class FoursquareAdapter {
  /**
   * Adapt a Foursquare place (search result or full details) into a `Place`.
   * Premium fields are mapped only when present, so this handles both lean
   * search rows and enriched detail responses.
   */
  adaptPlace(data: FoursquarePlace, id?: string): Place {
    const primaryId = id || `${SOURCE.FOURSQUARE}/${data.fsq_place_id}`
    const now = new Date().toISOString()

    return {
      id: primaryId,
      externalIds: {
        [SOURCE.FOURSQUARE]: data.fsq_place_id,
      },
      name: { value: data.name ?? null, sourceId: SOURCE.FOURSQUARE },
      description: null,
      placeType: attr(data.categories?.[0]?.name || 'unknown'),
      geometry: attr({
        type: 'point' as const,
        center: {
          lat: data.latitude ?? 0,
          lng: data.longitude ?? 0,
        },
      }),
      photos: this.extractPhotos(data),
      address: this.extractAddress(data),
      contactInfo: {
        phone: data.tel ? attr(data.tel) : null,
        email: data.email ? attr(data.email) : null,
        website: data.website ? attr(data.website) : null,
        socials: this.extractSocials(data),
      },
      openingHours: this.extractOpeningHours(data),
      amenities: this.extractAmenities(data),
      ratings: this.extractRatings(data),
      sources: [
        {
          id: SOURCE.FOURSQUARE,
          name: 'Foursquare',
          url: `https://foursquare.com/v/${data.fsq_place_id}`,
          updated: now,
        },
      ],
      lastUpdated: now,
      createdAt: now,
    }
  }

  private extractPhotos(data: FoursquarePlace): AttributedValue<PlacePhoto>[] {
    if (!data.photos?.length) return []

    const photos: AttributedValue<PlacePhoto>[] = []
    data.photos.forEach((p, index) => {
      if (!p.prefix || !p.suffix) return
      // Foursquare photo URLs are assembled as `${prefix}<size>${suffix}`.
      // "original" yields the full-resolution asset.
      const url = `${p.prefix}original${p.suffix}`
      photos.push({
        value: {
          url,
          sourceId: SOURCE.FOURSQUARE,
          width: p.width,
          height: p.height,
          isPrimary: index === 0,
        },
        sourceId: SOURCE.FOURSQUARE,
      })
    })
    return photos
  }

  private extractAddress(
    data: FoursquarePlace,
  ): AttributedValue<Address> | null {
    const loc = data.location
    if (!loc) return null
    if (
      !loc.address &&
      !loc.formatted_address &&
      !loc.locality &&
      !loc.region
    ) {
      return null
    }

    const address: Address = {
      street1: loc.address,
      locality: loc.locality,
      region: loc.region,
      postalCode: loc.postcode,
      country: loc.country,
      formatted:
        loc.formatted_address ||
        [loc.address, loc.locality, loc.region, loc.postcode]
          .filter(Boolean)
          .join(', ') ||
        undefined,
    }

    return attr(address)
  }

  private extractSocials(
    data: FoursquarePlace,
  ): Record<string, AttributedValue<string>> {
    const socials: Record<string, AttributedValue<string>> = {}
    const sm = data.social_media
    if (!sm) return socials

    if (sm.facebook_id) {
      socials.facebook = attr(`https://facebook.com/${sm.facebook_id}`)
    }
    if (sm.instagram) {
      socials.instagram = attr(
        `https://instagram.com/${sm.instagram.replace(/^@/, '')}`,
      )
    }
    if (sm.twitter) {
      socials.twitter = attr(
        `https://twitter.com/${sm.twitter.replace(/^@/, '')}`,
      )
    }
    return socials
  }

  private extractOpeningHours(
    data: FoursquarePlace,
  ): AttributedValue<OpeningHours> | null {
    const regular = data.hours?.regular
    if (!regular?.length) return null

    const regularHours: OpeningTime[] = []
    for (const period of regular) {
      const open = this.formatTime(period.open)
      const close = this.formatTime(period.close)
      if (!open || !close) continue
      regularHours.push({
        // Foursquare days are 1–7 (Mon–Sun); our schema is 0–6 (Sun–Sat).
        // `day % 7` maps 7→0 (Sun) and leaves 1–6 unchanged.
        day: period.day % 7,
        open,
        close,
      })
    }

    if (!regularHours.length) return null

    return attr({
      regularHours,
      isOpen24_7: false,
      isPermanentlyClosed: false,
      isTemporarilyClosed: false,
      rawText: data.hours?.display,
    })
  }

  /** Convert Foursquare "HHMM" (e.g. "0900") into "HH:mm". */
  private formatTime(value?: string): string | null {
    if (!value) return null
    const digits = value.replace(/\D/g, '')
    if (digits.length < 3) return null
    const padded = digits.padStart(4, '0')
    return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`
  }

  private extractAmenities(
    data: FoursquarePlace,
  ): Record<string, AttributedValue<string | boolean | number>> {
    const amenities: Record<string, AttributedValue<string | boolean | number>> =
      {}

    if (data.categories?.length) {
      for (const category of data.categories) {
        const key = category.fsq_category_id || category.id
        if (key) amenities[`type:${key}`] = attr(category.name || key)
      }
    }

    if (data.price !== undefined) {
      amenities.price_level = attr(String(data.price))
    }

    return amenities
  }

  private extractRatings(data: FoursquarePlace):
    | {
        rating: AttributedValue<number>
        reviewCount: AttributedValue<number>
      }
    | undefined {
    if (data.rating === undefined) return undefined

    const reviewCount =
      data.stats?.total_ratings ??
      data.stats?.total_tips ??
      data.tips?.length ??
      0

    return {
      // Foursquare rates 0–10; normalize to the 0–1 scale used across sources.
      rating: attr(Number((data.rating / 10).toFixed(2))),
      reviewCount: attr(reviewCount),
    }
  }
}
