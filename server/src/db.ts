import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as dotenv from 'dotenv'

dotenv.config({
  path: '.env.local',
})

export const dbUrl =
  process.env.NODE_ENV === 'production'
    ? (process.env.DATABASE_URL_NEON as string)
    : (process.env.DATABASE_URL_LOCAL as string)

export const connection = postgres(dbUrl)
export const db = drizzle(connection)
