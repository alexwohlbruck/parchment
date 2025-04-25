import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as dotenv from 'dotenv'
import * as schema from './schema/library.schema'

dotenv.config({
  path: '.env.local',
})

export const dbUrl = process.env.DATABASE_URL as string
export const dbUrlLocal = process.env.DATABASE_URL_LOCAL as string

export const connection = postgres(dbUrl)
export const db = drizzle(connection, { schema })
