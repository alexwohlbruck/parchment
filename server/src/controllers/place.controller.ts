import { Elysia, t } from 'elysia'
import { getSession, requireAuth } from '../middleware/auth.middleware.js'
import { DEFAULT_LANGUAGE } from '../lib/i18n/i18n.types'
import {
  lookupPlaceByNameAndLocation,
  lookupEnrichedPlaceById,
  lookupEnrichedPlaceByCoordinates,
} from '../services/place.service'
import { SOURCE } from '../lib/constants.js'
import { WidgetType } from '../types/place.types'
import { fetchWidgetData } from '../services/widget.service'

const app = new Elysia({ prefix: '/places' })
  .use(getSession)

// Get place by looking up source+id or name+lat+lng
app.get(
  '/details',
  async (ctx) => {
    const { query, user, i18n, t, status } = ctx as typeof ctx & { i18n?: { language: import('../lib/i18n').Language }; t?: any; status?: any }
    const language = i18n?.language ?? DEFAULT_LANGUAGE
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

    let place = null

    try {
      if (isIdLookup) {
        // TODO: Move this logic to a helper function
        // Special case for OSM provider: validate format
        if (source === SOURCE.OSM) {
          const [osmType, rawId] = id?.includes('/')
            ? id.split('/')
            : [null, id]

          if (!osmType || !['node', 'way', 'relation'].includes(osmType)) {
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
            console.log(`[place.controller] Geoapify place ${id} → OSM ${osmId}`)
            place = await lookupEnrichedPlaceById(SOURCE.OSM, osmId, {
              userId: user?.id,
              language,
            })
          } else {
            // No OSM ID, return Geoapify data as-is
            console.log(`[place.controller] Geoapify place ${id} has no OSM ID, returning Geoapify data`)
            place = geoapifyPlace
          }
        } else {
          place = await lookupEnrichedPlaceById(source!, id!, {
            userId: user?.id,
            language,
          })
        }
      } else if (isNameLocationLookup) {
        const coordinates = {
          lat: lat!,
          lng: lng!,
        }

        // Use the new method to get place by name and coordinates
        place = await lookupPlaceByNameAndLocation(name!, coordinates, {
          userId: user?.id,
          radius: Math.round(radius),
          language,
        })
      } else if (isCoordinateLookup) {
        // New: Coordinate-based lookup with enrichment
        place = await lookupEnrichedPlaceByCoordinates(lat!, lng!, {
          userId: user?.id,
          radius: Math.round(radius),
          language,
        })
      }

      if (!place) {
        return status(404, {
          message: t('errors.place.notFoundWithParams'),
        })
      }

      return place
    } catch (err) {
      console.error('Error in place lookup:', err)
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
        'Lookup and enrich place data. Supports ID-based lookup (source+id), name-based lookup (name+lat+lng), or coordinate-based lookup (lat+lng). Coordinate-based lookups perform reverse geocoding and run full enrichment if an OSM object is found.',
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
      console.error(`Error fetching widget data (${widgetType}):`, err)
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

export default app
