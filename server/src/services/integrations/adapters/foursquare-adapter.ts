import type {
  Place,
  PlacePhoto,
  AttributedValue,
  Address,
  OpeningHours,
  OpeningTime,
  Review,
} from '../../../types/place.types'
import { SOURCE } from '../../../lib/constants'

/**
 * A Foursquare "tip" — the platform's user-contributed review snippet. Rich
 * fields (lang / agree_count) come from the `/places/{id}/tips` sub-endpoint;
 * the inline `tips` place field only carries `text` + `created_at`.
 */
export interface FoursquareTip {
  fsq_tip_id?: string
  created_at?: string
  text?: string
  lang?: string
  agree_count?: number
  disagree_count?: number
  url?: string
}

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
  /** Boolean/enum service attributes (v2025 exposes a small stable set). */
  attributes?: {
    outdoor_seating?: boolean
    delivery?: boolean
    reservations?: boolean
    restroom?: boolean
    takes_credit_card?: boolean
    has_parking?: boolean
    /** wifi is a short enum string, e.g. "n" (none), "f"/"free", "p"/"paid". */
    wifi?: string
  }
  /** Descriptive taste tags (≤25), treated like OSM cuisine values. */
  tastes?: string[]
  /** 0–1 foot-traffic popularity over a ~6-month window. */
  popularity?: number
  /** Typical busy hours — same shape as `hours.regular`. */
  hours_popular?: Array<{ day: number; open: string; close: string }>
  /** Menu URL. */
  menu?: string
  /** ISO date the place was marked permanently closed. */
  date_closed?: string
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
      tags: this.extractTags(data),
      ratings: this.extractRatings(data),
      popularity: data.popularity != null ? attr(data.popularity) : undefined,
      popularHours: this.extractPopularHours(data) ?? undefined,
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

  /**
   * Map Foursquare tips into attributed reviews. Foursquare tips are unrated
   * text snippets with no author, so `rating`/`authorName` are left unset.
   */
  adaptReviews(tips: FoursquareTip[]): AttributedValue<Review>[] {
    if (!tips?.length) return []
    const reviews: AttributedValue<Review>[] = []
    for (const tip of tips) {
      const text = tip.text?.trim()
      if (!tip.fsq_tip_id || !text) continue
      const review: Review = {
        id: tip.fsq_tip_id,
        text,
        createdAt: tip.created_at,
        language: tip.lang,
        helpfulCount: tip.agree_count,
        url: tip.url,
      }
      reviews.push({ value: review, sourceId: SOURCE.FOURSQUARE })
    }
    return reviews
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

  /** Convert Foursquare hour periods into our OpeningTime[] shape. */
  private periodsToOpeningTimes(
    periods?: Array<{ day: number; open: string; close: string }>,
  ): OpeningTime[] {
    if (!periods?.length) return []
    const times: OpeningTime[] = []
    for (const period of periods) {
      const open = this.formatTime(period.open)
      const close = this.formatTime(period.close)
      if (!open || !close) continue
      // Foursquare days are 1–7 (Mon–Sun); our schema is 0–6 (Sun–Sat).
      // `day % 7` maps 7→0 (Sun) and leaves 1–6 unchanged.
      times.push({ day: period.day % 7, open, close })
    }
    return times
  }

  private extractOpeningHours(
    data: FoursquarePlace,
  ): AttributedValue<OpeningHours> | null {
    const regularHours = this.periodsToOpeningTimes(data.hours?.regular)
    const isPermanentlyClosed = !!data.date_closed
    // Nothing to report if there are neither hours nor a closure signal.
    if (!regularHours.length && !isPermanentlyClosed) return null
    return attr({
      regularHours,
      isOpen24_7: false,
      isPermanentlyClosed,
      isTemporarilyClosed: false,
      rawText: data.hours?.display,
    })
  }

  /** Typical busy hours, mapped into the same OpeningHours shape. */
  private extractPopularHours(
    data: FoursquarePlace,
  ): AttributedValue<OpeningHours> | null {
    const regularHours = this.periodsToOpeningTimes(data.hours_popular)
    if (!regularHours.length) return null
    return attr({
      regularHours,
      isOpen24_7: false,
      isPermanentlyClosed: false,
      isTemporarilyClosed: false,
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

    // Tastes flow into the same `cuisine` amenity the Cuisine card reads.
    const cuisine = this.normalizeTastes(data.tastes)
    if (cuisine) amenities.cuisine = attr(cuisine)

    return amenities
  }

  /**
   * Normalize Foursquare tastes into an OSM-style, `;`-joined cuisine string
   * (lowercased, spaces→underscores so `parseCuisines` renders them cleanly).
   */
  private normalizeTastes(tastes?: string[]): string | null {
    if (!tastes?.length) return null
    const seen = new Set<string>()
    const values: string[] = []
    for (const taste of tastes) {
      const v = taste.trim().toLowerCase().replace(/\s+/g, '_')
      if (v && !seen.has(v)) {
        seen.add(v)
        values.push(v)
      }
    }
    return values.length ? values.join(';') : null
  }

  /**
   * Map Foursquare attributes onto raw OSM tag keys/values so they flow through
   * the same DisplayChips + Cuisine pipeline as OSM data (chips read
   * `place.tags`). Booleans become "yes"/"no"; `has_parking` uses an invented
   * `parking` key since OSM has no documented POI-level parking-availability
   * tag. `menu` → the official `website:menu` tag.
   */
  private extractTags(data: FoursquarePlace): Record<string, string> {
    const tags: Record<string, string> = {}
    const a = data.attributes
    const yn = (b: boolean) => (b ? 'yes' : 'no')

    if (a) {
      if (a.outdoor_seating !== undefined)
        tags.outdoor_seating = yn(a.outdoor_seating)
      if (a.delivery !== undefined) tags.delivery = yn(a.delivery)
      if (a.reservations !== undefined) tags.reservation = yn(a.reservations)
      if (a.restroom !== undefined) tags.toilets = yn(a.restroom)
      if (a.takes_credit_card !== undefined)
        tags['payment:credit_cards'] = yn(a.takes_credit_card)
      if (a.has_parking !== undefined) tags.parking = yn(a.has_parking)
      if (a.wifi !== undefined) {
        const w = a.wifi?.trim().toLowerCase()
        if (!w || w === 'n' || w === 'no' || w === 'none') {
          tags.internet_access = 'no'
        } else {
          tags.internet_access = 'wlan'
          if (w === 'p' || w === 'paid') tags['internet_access:fee'] = 'yes'
          else if (w === 'f' || w === 'free')
            tags['internet_access:fee'] = 'no'
        }
      }
    }

    const cuisine = this.normalizeTastes(data.tastes)
    if (cuisine) tags.cuisine = cuisine
    if (data.menu) tags['website:menu'] = data.menu

    return tags
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
