import { Elysia, t } from 'elysia'
import { makeClientRateLimit } from '../middleware/rate-limit.middleware'
import { getSession, permissions, requireAuth } from '../middleware/auth.middleware.js'
import { DEFAULT_LANGUAGE } from '../lib/i18n/i18n.types'
import {
  lookupPlaceByNameAndLocation,
  lookupEnrichedPlaceById,
  lookupEnrichedPlaceByCoordinates,
} from '../services/place.service'
import { getPermissions, hasPermission } from '../services/auth.service'
import { PermissionId } from '../types/auth.types'
import { SOURCE } from '../lib/constants.js'
import { WidgetType } from '../types/place.types'
import { fetchWidgetData } from '../services/widget.service'
import { fetchNearestStreetImage } from '../services/street-imagery.service'
import { getStayRates } from '../services/stay.service'
import { isValidStay, MAX_STAY_ADULTS } from '../lib/place/stay-dates'
import { isVenueId, isVenueProvider } from '../lib/place/booking-venues'
import { getBookingVenues } from '../services/place/booking-venues.service'
import { logError, logger } from '../lib/logger'
import { i18nPlugin } from '../lib/i18n/plugin'
import type { Source } from '../lib/constants'
import {
  correctListing,
  getPlaceListings,
  searchListingCandidates,
} from '../services/place/listing-matches.service'

const app = new Elysia({ prefix: '/places' })
  .use(i18nPlugin)
  .use(getSession)
  .use(makeClientRateLimit({ name: 'places', limit: 300 }))

// Get place by looking up source+id or name+lat+lng
app.get(
  '/details',
  async (ctx) => {
    const { query, user, language, t, status } = ctx
    const { source, id, name, lat, lng, radius = 500 } = query

    const isIdLookup = Boolean(source) && Boolean(id)
    const isNameLocationLookup = Boolean(name) && lat !== undefined && lng !== undefined
    const isCoordinateLookup =
      (lat !== undefined && lng !== undefined) &&
      !isIdLookup &&
      !isNameLocationLookup

    // Check for at least one valid lookup parameter
    if (!isIdLookup && !isNameLocationLookup && !isCoordinateLookup) {
      return status(400, {
        message: t('errors.place.invalidParams'),
      })
    }

    // Check if user has premium data provider access
    const userPerms = user ? await getPermissions(user.id) : []
    const premiumData = hasPermission(userPerms, PermissionId.PREMIUM_DATA_PROVIDERS)

    let place = null

    try {
      if (isIdLookup) {
        // TODO: Move this logic to a helper function
        // Special case for OSM provider: validate format
        if (source === SOURCE.OSM) {
          const [osmType, rawId] = id?.includes('/')
            ? id.split('/')
            : [null, id]

          if (!osmType || !['node', 'way', 'relation', 'intersection'].includes(osmType)) {
            return status(400, {
              message: t('errors.place.invalidOsmType'),
            })
          }
        }
        
        // Special case for Geoapify: Extract OSM ID and redirect to OSM lookup
        // Geoapify is not a primary data source, only used for geocoding/routing
        if (source === SOURCE.GEOAPIFY) {
          const { integrationManager } = await import('../services/integrations/index.js')
          const { IntegrationId, IntegrationCapabilityId } = await import('../types/integration.enums.js')
          
          // Get the Geoapify integration with placeInfo capability
          const geoapifyRecords = integrationManager
            .getConfiguredIntegrationsByCapability(IntegrationCapabilityId.PLACE_INFO)
            .filter((int) => int.integrationId === IntegrationId.GEOAPIFY)
          
          if (!geoapifyRecords.length) {
            return status(500, {
              message: t('errors.integration.notAvailable'),
            })
          }
          
          const geoapifyIntegration = integrationManager.getCachedIntegrationInstance(geoapifyRecords[0])
          
          if (!geoapifyIntegration?.capabilities.placeInfo) {
            return status(500, {
              message: t('errors.integration.notAvailable'),
            })
          }
          
          const geoapifyPlace = await geoapifyIntegration.capabilities.placeInfo.getPlaceInfo(id!)
          
          if (!geoapifyPlace) {
            return status(404, {
              message: t('errors.notFound.place'),
            })
          }
          
          const osmId = geoapifyPlace?.externalIds?.[SOURCE.OSM]
          
          if (osmId) {
            // If OSM ID exists, get enriched data from OSM
            logger.debug(`[place.controller] Geoapify place ${id} → OSM ${osmId}`)
            place = await lookupEnrichedPlaceById(SOURCE.OSM, osmId, {
              userId: user?.id,
              language,
              premiumData,
            })
          } else {
            // No OSM ID, return Geoapify data as-is
            logger.debug(`[place.controller] Geoapify place ${id} has no OSM ID, returning Geoapify data`)
            place = geoapifyPlace
          }
        } else {
          place = await lookupEnrichedPlaceById(source!, id!, {
            userId: user?.id,
            language,
            premiumData,
          })
        }
      } else if (isNameLocationLookup) {
        const coordinates = {
          lat: lat!,
          lng: lng!,
        }

        // Resolve the name and point to a place...
        place = await lookupPlaceByNameAndLocation(name!, coordinates, {
          userId: user?.id,
          radius: Math.round(radius),
          language,
        })

        // ...then look it up again by the id that resolved to, so this route
        // answers with the same place the id route does.
        //
        // The name lookup returns whatever the provider search found, and that
        // is not an enriched place: no widget descriptors, so no departures,
        // no OSM tags, no related places. A transit station reached this way
        // rendered as a name, an address and a phone number, while the very
        // same node reached by id showed its whole board. Both URLs name one
        // place and should answer alike.
        // Its OWN id, not `externalIds[OSM]` — those can point at a different
        // object entirely. Here the node the name resolved to carried an
        // external id for the platform WAY beside it, and enriching that
        // opened "Brooklyn Bridge-City Hall (4,5,6,<6>)" instead of the
        // station a tap on the map opens.
        const [idSource, ...idRest] = (place?.id ?? '').split('/')
        const resolvedOsmId = idSource === SOURCE.OSM ? idRest.join('/') : null
        if (resolvedOsmId) {
          place =
            (await lookupEnrichedPlaceById(SOURCE.OSM, resolvedOsmId, {
              userId: user?.id,
              language,
              premiumData,
            })) ?? place
        }
      } else if (isCoordinateLookup) {
        place = await lookupEnrichedPlaceByCoordinates(lat!, lng!, {
          userId: user?.id,
          radius: Math.round(radius),
          language,
          addressOnly: true,
          premiumData,
        })
      }

      if (!place) {
        return status(404, {
          message: t('errors.place.notFoundWithParams'),
        })
      }

      return place
    } catch (err) {
      logError('Error in place lookup', err)
      return status(500, {
        message: t('errors.place.retrievalError'),
      })
    }
  },
  {
    query: t.Object({
      source: t.Optional(t.Enum(SOURCE)),
      id: t.Optional(t.String()),
      name: t.Optional(t.String()),
      lat: t.Optional(t.Number()),
      lng: t.Optional(t.Number()),
      radius: t.Optional(t.Number()),
      lang: t.Optional(t.String()),
    }),
    detail: {
      tags: ['Places'],
      summary: 'Get place details by ID, name/location, or coordinates',
      description:
        'Lookup and enrich place data. Supports ID-based lookup (source+id), name-based lookup (name+lat+lng), or coordinate-based lookup (lat+lng). Coordinate-based lookups reverse geocode; when the coordinate lands on a named place, that place is returned fully enriched with its center pinned to the coordinate, otherwise the coordinate itself with its address.',
    },
  },
)

// Fetch widget data by type
app.get(
  '/widgets/:type',
  async (ctx) => {
    const { params, query, status } = ctx as typeof ctx & { status?: any }
    const widgetType = params.type as WidgetType

    // Validate widget type
    if (!Object.values(WidgetType).includes(widgetType)) {
      return status(400, {
        message: `Unknown widget type: ${widgetType}`,
      })
    }

    try {
      const result = await fetchWidgetData(widgetType, query as Record<string, string>)
      return result
    } catch (err) {
      logError(`Error fetching widget data (${widgetType})`, err)
      return status(500, {
        message: err instanceof Error ? err.message : 'Error fetching widget data',
      })
    }
  },
  {
    params: t.Object({
      type: t.String(),
    }),
    query: t.Record(t.String(), t.Optional(t.String())),
    detail: {
      tags: ['Places'],
      summary: 'Get widget data for a place',
      description:
        'Fetch additional widget data (transit departures, etc.) separately from the base place lookup. Query parameters vary by widget type.',
    },
  },
)

// Nearest street-level imagery to a coordinate (Mapillary). Powers the
// floating street view preview on the place detail.
app.get(
  '/street-imagery',
  async (ctx) => {
    const { query, status, t } = ctx
    const lat = parseFloat(query.lat as string)
    const lng = parseFloat(query.lng as string)

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return status(400, { message: t('errors.place.coordinatesRequired') })
    }

    try {
      const preview = await fetchNearestStreetImage(lat, lng)
      return { preview }
    } catch (err) {
      logError('Error fetching street imagery', err)
      return status(500, {
        message: err instanceof Error ? err.message : 'Error fetching street imagery',
      })
    }
  },
  {
    query: t.Object({
      lat: t.String(),
      lng: t.String(),
    }),
    detail: {
      tags: ['Places'],
      summary: 'Get nearest street-level image to a coordinate',
    },
  },
)

// Live room rates for the hotel at a place, for one set of dates and guests.
app.get(
  '/stay-rates',
  async (ctx) => {
    const { query, status, t } = ctx
    if (!isValidStay(query.checkin, query.checkout)) {
      return status(400, { message: t('errors.place.invalidStay') })
    }
    try {
      const rates = await getStayRates(query.source as Source, query.id, {
        checkin: query.checkin,
        checkout: query.checkout,
        adults: query.adults ?? 2,
        currency: query.currency?.toUpperCase() ?? 'USD',
        guestNationality: query.nationality?.toUpperCase() ?? 'US',
      })
      return { rates }
    } catch (err) {
      logError('Error fetching stay rates', err)
      return status(502, { message: err instanceof Error ? err.message : 'Error fetching stay rates' })
    }
  },
  {
    query: t.Object({
      source: t.String({ minLength: 1, description: 'Place source, e.g. osm' }),
      id: t.String({ minLength: 1, description: 'Place id within its source, e.g. node/4176535246' }),
      checkin: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' }),
      checkout: t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' }),
      adults: t.Optional(t.Numeric({ minimum: 1, maximum: MAX_STAY_ADULTS, default: 2 })),
      currency: t.Optional(t.String({ pattern: '^[A-Za-z]{3}$', description: 'ISO 4217, default USD' })),
      nationality: t.Optional(t.String({ pattern: '^[A-Za-z]{2}$', description: 'ISO 3166-1 alpha-2, default US' })),
    }),
    detail: {
      tags: ['Places'],
      summary: 'Get live room rates for a hotel',
      description:
        'Uses the place\'s stored LiteAPI listing, matching one the first time (a nearby hotel with the same name within 250 m) and storing the result, a miss included, and returns the cheapest offer per room for the dates and guests, each with a checkout link for that exact offer. `rates` is null when no provider is configured or the place has no matched listing. Stays run 1 to 30 nights. Cached for 10 minutes.',
    },
  },
)

const placeKey = {
  source: t.String({ description: 'Source of the place, e.g. `osm`', examples: ['osm'] }),
  id: t.String({ description: 'Id in that source, e.g. `node/6493733562`', examples: ['node/6493733562'] }),
}
const providerKey = t.String({
  pattern: '^[a-z][a-z0-9_-]{1,31}$',
  description: 'Provider of the listing, e.g. `google`, `foursquare`',
})

// Matches are shared map data: one correction changes the place for every user.
app.group('/listings', (listings) =>
  listings
    .use(permissions(PermissionId.PLACES_LISTINGS_WRITE))
    .get(
      '/',
      async ({ query, language }) => ({
        listings: await getPlaceListings(query.source as Source, query.id, { language }),
      }),
      {
        query: t.Object(placeKey),
        detail: {
          tags: ['Places'],
          summary: 'Get the business listings a place is matched to',
          description:
            'One entry per provider the place can be matched at: the matched listing (null for none), whether a person confirmed it, and whether candidates can be searched.',
        },
      },
    )
    .get(
      '/candidates',
      async ({ query, language }) => ({
        candidates: await searchListingCandidates(query.source as Source, query.id, query.provider, {
          query: query.q,
          language,
        }),
      }),
      {
        query: t.Object({ ...placeKey, provider: providerKey, q: t.Optional(t.String({ maxLength: 200 })) }),
        detail: {
          tags: ['Places'],
          summary: 'Search nearby listings at one provider',
          description: 'Listings within 500 m of the place, nearest first. `q` defaults to the place name.',
        },
      },
    )
    .put(
      '/',
      async ({ body, status, t }) => {
        if (body.providerPlaceId && isVenueProvider(body.provider) && !isVenueId(body.provider, body.providerPlaceId)) {
          return status(400, { message: t('errors.place.listingInvalid') })
        }
        const stored = await correctListing(body.source as Source, body.id, body.provider, body.providerPlaceId)
        if (!stored) return status(400, { message: t('errors.place.listingUnsupported') })
        return { ok: true }
      },
      {
        body: t.Object({
          ...placeKey,
          provider: providerKey,
          providerPlaceId: t.Nullable(t.String({ minLength: 1, maxLength: 255 })),
        }),
        detail: {
          tags: ['Places'],
          summary: 'Correct the listing a place is matched to',
          description:
            'Sets the listing for one provider, or `providerPlaceId: null` for none. Stored as a confirmed match that automatic matching never replaces. OSM places only. Booking sites (`opentable`, `resy`, `booking`, `expedia`) take the venue id parsed from its page URL, e.g. `r/<slug>` or `us/<hotel>`; anything else is a 400.',
        },
      },
    ),
)

// The place's own page on each booking site, so links open the venue rather than a search.
app.get(
  '/booking-venues',
  async ({ query, status }) => {
    try {
      return await getBookingVenues(query.source as Source, query.id)
    } catch (err) {
      logError('Error fetching booking venues', err)
      return status(502, { message: err instanceof Error ? err.message : 'Error fetching booking venues' })
    }
  },
  {
    query: t.Object(placeKey),
    detail: {
      tags: ['Places'],
      summary: "Get a place's venues on booking sites",
      description:
        'Venue ids on OpenTable, Resy, Booking.com and Expedia from the match store, keyed by provider, plus `unlisted`: sites a person marked as not listing the place. A booking page tagged on the place (`reservation:website`, `website:booking`, …) fills its site in on first request, unconfirmed.',
    },
  },
)


export default app
