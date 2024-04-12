import postgres from 'postgres'
import { neon } from '@neondatabase/serverless'
import {
  drizzle as NeonAdapter,
  type NeonHttpDatabase,
} from 'drizzle-orm/neon-http'
import {
  drizzle as LocalAdapter,
  type PostgresJsDatabase,
} from 'drizzle-orm/postgres-js'

let db:
  | NeonHttpDatabase<Record<string, never>>
  | PostgresJsDatabase<Record<string, never>>

if (process.env.NODE_ENV === 'production') {
  const sql = neon(process.env.DATABASE_URL_NEON as string)
  db = NeonAdapter(sql)
} else {
  const sql = postgres(process.env.DATABASE_URL_LOCAL as string)
  db = LocalAdapter(sql)
}

export { db }
