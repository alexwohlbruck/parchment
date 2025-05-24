import { Elysia, t, error } from 'elysia'
import { getSession, requireAuth } from '../middleware/auth.middleware.js'
import {
  lookupPlaceByNameAndLocation,
  getPlaceAutocomplete,
  lookupAndMergePlaceById,
  lookupPlacesByNameAndLocation,
} from '../services/place.service'
import { SOURCE, Source } from '../lib/constants.js'
const app = new Elysia({ prefix: '/places' }).use(getSession)

// Get place by looking up source+id or name+lat+lng
app.get(
  '/lookup',
  async ({ query, user }) => {
    const { provider, id, name, lat, lng, radius = 500 } = query
    const source = provider as Source // TODO: Rename query param to 'source' and update type

    const isIdLookup = source && id
    const isNameLocationLookup = name && lat && lng

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
          const [osmType, rawId] = id.includes('/') ? id.split('/') : [null, id]

          if (!osmType || !['node', 'way', 'relation'].includes(osmType)) {
            return error(400, {
              message:
                'Invalid OSM type. Format should be "type/id" where type is node, way, or relation.',
            })
          }
        }

        place = await lookupAndMergePlaceById(source, id, {
          userId: user?.id,
        })
      } else if (isNameLocationLookup) {
        const coordinates = {
          lat: parseFloat(lat),
          lng: parseFloat(lng),
        }

        // Use the new method to get place by name and coordinates
        place = await lookupPlaceByNameAndLocation(name, coordinates, {
          userId: user?.id,
          radius: parseInt(radius as string),
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
      provider: t.Optional(t.String()),
      id: t.Optional(t.String()),
      name: t.Optional(t.String()),
      lat: t.Optional(t.String()),
      lng: t.Optional(t.String()),
      radius: t.Optional(t.String()),
    }),
  },
)

// Autocomplete search for fast suggestions
app.get(
  '/autocomplete',
  async ({ query }) => {
    const { q, lat, lng, radius = 10000 } = query

    console.log(
      `Autocomplete request: q="${q}", lat=${lat}, lng=${lng}, radius=${radius}`,
    )

    if (!q) {
      return error(400, { message: 'Search query is required' })
    }

    // Require at least 2 characters for autocomplete
    if (q.length < 2) {
      return error(400, { message: 'Query must be at least 2 characters' })
    }

    // Convert coordinates to numbers if provided
    const coordinates =
      lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined

    const places = await getPlaceAutocomplete(
      q,
      coordinates,
      parseInt(radius as string),
    )

    console.log(`Returning ${places.length} places for autocomplete`)
    console.log(
      `Sources breakdown: ${places.reduce((acc, place) => {
        const source = place.sources[0]?.id || 'unknown'
        acc[source] = (acc[source] || 0) + 1
        return acc
      }, {} as Record<string, number>)}`,
    )

    return {
      query: q,
      places,
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
