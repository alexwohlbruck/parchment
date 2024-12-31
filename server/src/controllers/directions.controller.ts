import { Elysia } from 'elysia'
import { getRoute } from '../services/valhalla.service'
import type { Location, ValhallaRouteRequest } from '../types/valhalla.types.ts'

const app = new Elysia({ prefix: '/directions' })

app.post('/', async ({ body: { locations, costing, options } }) => {
  const payload: ValhallaRouteRequest = {
    locations: locations.map((l: Location) => ({
      lat: l.value[0],
      lon: l.value[1],
    })),
    costing,
  }

  console.log(payload)
  return (await getRoute(payload)).trip
})

export default app
