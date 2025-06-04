import { Elysia, t, error } from 'elysia'
import { getSession, requireAuth } from '../middleware/auth.middleware.js'
import {
  lookupPlaceByNameAndLocation,
  lookupEnrichedPlaceById,
  lookupPlacesByNameAndLocation,
} from '../services/place.service'
import { SOURCE } from '../lib/constants.js'
const app = new Elysia({ prefix: '/places' }).use(getSession)

// Get place by looking up source+id or name+lat+lng
app.get(
  '/lookup',
  async ({ query, user }) => {
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
      autocomplete: t.Optional(t.Boolean()),
    }),
  },
)

// Autocomplete search for fast suggestions
app.get(
  '/autocomplete',
  async ({ query }) => {
    const { q, lat, lng, radius = 10000 } = query

    if (!q) {
      return error(400, { message: 'Search query is required' })
    }

    // Require at least 2 characters for autocomplete
    if (q.length < 2) {
      return error(400, { message: 'Query must be at least 2 characters' })
    }

    const places = await lookupPlacesByNameAndLocation(
      q,
      { lat, lng },
      {
        radius: parseInt(radius as string),
        autocomplete: true,
      },
    )

    return {
      query: q,
      places,
    }
  },
  {
    query: t.Object({
      q: t.String(),
      lat: t.Number(),
      lng: t.Number(),
      radius: t.Optional(t.String()),
    }),
  },
)

// Search for places by name
app.get(
  '/search',
  async ({ query, user }) => {
    const { q, lat, lng, radius = 1000 } = query

    if (!q) {
      return error(400, { message: 'Search query is required' })
    }

    if (!lat || !lng) {
      return error(400, { message: 'Latitude and longitude are required' })
    }

    const coordinates = { lat: parseFloat(lat), lng: parseFloat(lng) }

    const results = await lookupPlacesByNameAndLocation(q, coordinates, {
      radius: parseInt(radius as string),
      userId: user?.id,
    })

    return {
      query: q,
      results,
    }
  },
  {
    query: t.Object({
      q: t.String(),
      lat: t.Optional(t.String()),
      lng: t.Optional(t.String()),
      radius: t.Optional(t.String()),
    }),
  },
)

export default app
