import 'dotenv/config'
import { migrate } from 'drizzle-orm/neon-http/migrator'
import { db, connection } from './db'

await migrate(db, { migrationsFolder: 'drizzle' })

console.log('Migration finished')

await connection.end()
