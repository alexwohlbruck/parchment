import { Elysia, t, error } from 'elysia'
import { getSession, requireAuth } from '../middleware/auth.middleware.js'
import {
  getPlaceDetails,
  searchPlaces,
  getPlaceAutocomplete,
  getPlaceDetailsByProviderId,
  getPlaceDetailsByNameAndLocation,
} from '../services/place.service'

const app = new Elysia({ prefix: '/places' }).use(getSession)

const placeTypeSchema = t.Union([
  t.Literal('node'),
  t.Literal('way'),
  t.Literal('relation'),
])

// Get place by provider+id, name+lat+lng, or id
app.get(
  '/lookup',
  async ({ query, user }) => {
    const { provider, id, name, lat, lng, radius = 500 } = query

    // Check for at least one valid lookup parameter
    if (!((provider && id) || (name && lat && lng))) {
      return error(400, {
        message: 'Please provide either provider+id, or name+lat+lng',
      })
    }

    let place = null

    // Handle provider-specific ID lookup
    if (provider && id) {
      // Special handling for OSM
      if (provider === 'osm') {
        const [osmType, rawId] = id.includes('/') ? id.split('/') : [null, id]

        if (!osmType || !['node', 'way', 'relation'].includes(osmType)) {
          return error(400, {
            message:
              'Invalid OSM type. Format should be "type/id" where type is node, way, or relation.',
          })
        }

        place = await getPlaceDetails(id, user?.id ?? null)
      }
      // Handle other providers through common interface
      else {
        place = await getPlaceDetailsByProviderId(
          provider,
          id,
          user?.id ?? null,
        )
      }
    }
    // Handle name+location lookup
    else if (name && lat && lng) {
      const coordinates = { lat: parseFloat(lat), lng: parseFloat(lng) }
      place = await getPlaceDetailsByNameAndLocation(
        name,
        coordinates,
        user?.id ?? null,
        parseInt(radius as string),
      )
    }

    if (!place) {
      return error(404, {
        message: 'Place not found with the provided parameters',
      })
    }

    return place
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

// Get place details by id
app.get(
  '/:id',
  async ({ params: { id }, user }) => {
    const place = await getPlaceDetails(id, user?.id ?? null)

    if (!place) {
      return error(404, { message: `Place not found: ${id}` })
    }

    return place
  },
  {
    params: t.Object({
      type: placeTypeSchema,
      id: t.String(),
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

    // Convert coordinates to numbers if provided
    const coordinates =
      lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined

    const results = await searchPlaces(
      q,
      user?.id ?? null,
      coordinates,
      parseInt(radius as string),
    )

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
