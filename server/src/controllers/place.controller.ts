import { Elysia, t, error } from 'elysia'
import { getPlaceDetails } from '../services/place.service'
import { adaptOsmPlace } from '../adapters/osm-adapter'

const app = new Elysia({ prefix: '/places' })

const placeTypeSchema = t.Union([
  t.Literal('node'),
  t.Literal('way'),
  t.Literal('relation'),
])

app.get(
  '/:type/:id',
  async ({ params: { type, id } }) => {
    // Validate type parameter
    if (!['node', 'way', 'relation'].includes(type)) {
      return error(400, {
        message: 'Invalid place type. Must be node, way, or relation.',
      })
    }

    const osmPlace = await getPlaceDetails(
      type as 'node' | 'way' | 'relation',
      id,
    )

    if (!osmPlace) {
      return error(404, { message: `Place not found: ${type}/${id}` })
    }

    const unifiedPlace = adaptOsmPlace(osmPlace)

    return unifiedPlace
  },
  {
    params: t.Object({
      type: placeTypeSchema,
      id: t.String(),
    }),
  },
)

export default app
