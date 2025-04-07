import { Elysia, t, error } from 'elysia'
import { getPlaceDetails } from '../services/place.service'

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

export default app
