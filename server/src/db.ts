import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as dotenv from 'dotenv'

dotenv.config({
  path: '.env.local',
})

export const dbUrl = process.env.DATABASE_URL as string

export const connection = postgres(dbUrl)
export const db = drizzle(connection)
