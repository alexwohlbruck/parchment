import * as dotenv from 'dotenv'
dotenv.config()

import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { cors as corsConfig, swagger as swaggerConfig } from './config'
import { auth as authController, user as userController } from './controllers'

const app = new Elysia()

app.use(cors(corsConfig))
app.use(swagger(swaggerConfig))

app.use(authController)
app.use(userController)

app.onError(({ code }) => {
  if (code === 'NOT_FOUND') return 'Route not found :('
})

app.listen(5000)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
)
