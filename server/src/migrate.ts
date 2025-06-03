import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, connection } from './db'

await migrate(db, { migrationsFolder: 'drizzle' })

console.log('Migration finished')

await connection.end()
