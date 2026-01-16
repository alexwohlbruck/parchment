import { Elysia, t, error } from 'elysia'
import { getSession, requireAuth } from '../middleware/auth.middleware.js'
import i18nMiddleware from '../middleware/i18n.middleware.js'
import {
  lookupPlaceByNameAndLocation,
  lookupEnrichedPlaceById,
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
    const isNameLocationLookup = Boolean(name) && Boolean(lat) && Boolean(lng)

    // Check for at least one valid lookup parameter
    if (!isIdLookup && !isNameLocationLookup) {
      return error(400, {
        message: 'Please provide either provider+id, or name+lat+lng',
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

        place = await lookupEnrichedPlaceById(source!, id!, {
          userId: user?.id,
          language,
        })
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
      summary: 'Get place details by ID or name/location',
    },
  },
)

export default app
