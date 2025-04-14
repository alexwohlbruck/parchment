import { Elysia, t, error } from 'elysia'
import {
  getPlaceDetails,
  searchPlaces,
  getPlaceAutocomplete,
} from '../services/place.service'

const app = new Elysia({ prefix: '/places' })

const placeTypeSchema = t.Union([
  t.Literal('node'),
  t.Literal('way'),
  t.Literal('relation'),
])

app.get(
  '/:type/:id',
  async ({ params: { type, id } }) => {
    if (!['node', 'way', 'relation'].includes(type)) {
      return error(400, {
        message: 'Invalid place type. Must be node, way, or relation.',
      })
    }

    const place = await getPlaceDetails(type as 'node' | 'way' | 'relation', id)

    if (!place) {
      return error(404, { message: `Place not found: ${type}/${id}` })
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

// Add search endpoint
app.get(
  '/search',
  async ({ query }) => {
    const { q, lat, lng, radius = 1000 } = query

    if (!q) {
      return error(400, { message: 'Search query is required' })
    }

    // Convert coordinates to numbers if provided
    const coordinates =
      lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined

    const results = await searchPlaces(
      q,
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

// Add autocomplete endpoint for faster search suggestions
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

    // Convert coordinates to numbers if provided
    const coordinates =
      lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined

    const suggestions = await getPlaceAutocomplete(
      q,
      coordinates,
      parseInt(radius as string),
    )

    return {
      query: q,
      suggestions,
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
