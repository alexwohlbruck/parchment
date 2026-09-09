import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, connection } from './db'

// Enable pg_trgm extension for fuzzy text search (PostGIS already enabled by kartoza/postgis image)
console.log('Enabling pg_trgm extension...')
await db.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm;')

console.log('Granting database privileges...')
const dbUser = process.env.POSTGRES_USER || 'postgres'
await db.execute(
  `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${dbUser};`,
)
await db.execute(
  `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${dbUser};`,
)
await db.execute(
  `GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO ${dbUser};`,
)

await migrate(db, { migrationsFolder: 'drizzle' })

console.log('Migration finished')

await connection.end()
