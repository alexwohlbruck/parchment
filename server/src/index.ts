import { Elysia, t } from 'elysia'

const app = new Elysia()

app.group('/layers', (app) =>
  app.get('/', ({ set }) => {
    return {
      layers: [
        { id: 1, name: 'Layer 1' },
        { id: 2, name: 'Layer 2' },
      ],
    }
  }),
)

app.onError(({ code }) => {
  if (code === 'NOT_FOUND') return 'Route not found :('
})

app.listen(5000)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
)
