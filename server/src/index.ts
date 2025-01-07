import * as dotenv from 'dotenv'
dotenv.config()

import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { cors as corsConfig, swagger as swaggerConfig } from './config'
import {
  auth as authController,
  user as userController,
  directions as directionsController,
} from './controllers'

const app = new Elysia()

app.use(cors(corsConfig) as any) // TODO: any
app.use(swagger(swaggerConfig))

app.use(authController)
app.use(userController)
app.use(directionsController)

app.onError(({ code }) => {
  if (code === 'NOT_FOUND') return 'Route not found :(' // TODO: i18n, proper error
})

app.listen(process.env.PORT || 5000)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
)
