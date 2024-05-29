import postgres from 'postgres'
import { Pool } from '@neondatabase/serverless'
import {
  drizzle as NeonAdapter,
  type NeonDatabase,
} from 'drizzle-orm/neon-serverless'
import {
  drizzle as LocalAdapter,
  type PostgresJsDatabase,
} from 'drizzle-orm/postgres-js'

let connection: any
let db:
  | NeonDatabase<Record<string, never>>
  | PostgresJsDatabase<Record<string, never>>

if (process.env.NODE_ENV === 'production') {
  connection = new Pool({
    connectionString: process.env.DATABASE_URL_NEON as string,
  })
  db = NeonAdapter(connection)
} else {
  connection = postgres(process.env.DATABASE_URL_LOCAL as string)
  db = LocalAdapter(connection)
}

export { db, connection }
