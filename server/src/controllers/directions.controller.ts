import { Elysia, t } from 'elysia'
import { routingService } from '../services/routing.service'
import type { Location } from '../types/valhalla.types.ts'

const app = new Elysia({ prefix: '/directions' })

app.post(
  '/',
  async ({ body: { locations, costing, options } }) => {
    try {
      const result = await routingService.getRoute(
        locations as Location[],
        costing,
        options,
      )

      // Return the unified route format
      return result
    } catch (error) {
      console.error('Directions error:', error)
      throw new Error(
        `Failed to get directions: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  },
  {
    body: t.Object({
      locations: t.Array(
        t.Object({
          type: t.Literal('coordinates'),
          value: t.Tuple([t.Number(), t.Number()]),
        }),
      ),
      costing: t.Optional(t.String()),
      options: t.Optional(t.Any()),
    }),
  },
)

export default app
