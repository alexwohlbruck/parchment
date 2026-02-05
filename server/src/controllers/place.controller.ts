import { Elysia, t, error } from 'elysia'
import { getSession, requireAuth } from '../middleware/auth.middleware.js'
import i18nMiddleware from '../middleware/i18n.middleware.js'
import {
  lookupPlaceByNameAndLocation,
  lookupEnrichedPlaceById,
  lookupEnrichedPlaceByCoordinates,
} from '../services/place.service'
import { SOURCE } from '../lib/constants.js'
const app = new Elysia({ prefix: '/places' })
  .use(getSession)
  .use(i18nMiddleware)

// Get place by looking up source+id or name+lat+lng
app.get(
  '/details',
  async ({ query, user, language }) => {
    const { source, id, name, lat, lng, radius = 500 } = query

    const isIdLookup = Boolean(source) && Boolean(id)
    const isNameLocationLookup = Boolean(name) && lat !== undefined && lng !== undefined
    const isCoordinateLookup =
      (lat !== undefined && lng !== undefined) &&
      !isIdLookup &&
      !isNameLocationLookup

    // Check for at least one valid lookup parameter
    if (!isIdLookup && !isNameLocationLookup && !isCoordinateLookup) {
      return error(400, {
        message: 'Please provide either source+id, name+lat+lng, or lat+lng',
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
            return error(400, {
              message:
                'Invalid OSM type. Format should be "type/id" where type is node, way, or relation.',
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
            return error(500, {
              message: 'Geoapify integration not available',
            })
          }
          
          const geoapifyIntegration = integrationManager.getCachedIntegrationInstance(geoapifyRecords[0])
          
          if (!geoapifyIntegration?.capabilities.placeInfo) {
            return error(500, {
              message: 'Geoapify placeInfo capability not available',
            })
          }
          
          const geoapifyPlace = await geoapifyIntegration.capabilities.placeInfo.getPlaceInfo(id!)
          const osmId = geoapifyPlace?.externalIds?.[SOURCE.OSM]
          
          if (osmId) {
            console.log(`[place.controller] Geoapify place ${id} → OSM ${osmId}`)
            place = await lookupEnrichedPlaceById(SOURCE.OSM, osmId, {
              userId: user?.id,
              language,
            })
          } else {
            return error(404, {
              message: 'Geoapify place does not have an OSM ID for full details',
            })
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
        return error(404, {
          message: 'Place not found with the provided parameters',
        })
      }

      return place
    } catch (err) {
      console.error('Error in place lookup:', err)
      return error(500, {
        message: 'Error retrieving place data',
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

export default app
