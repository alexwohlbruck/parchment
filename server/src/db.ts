import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

const dbUrl =
  process.env.NODE_ENV === 'production'
    ? (process.env.DATABASE_URL_NEON as string)
    : (process.env.DATABASE_URL_LOCAL as string)

export const connection = postgres(dbUrl)
export const db = drizzle(connection)
