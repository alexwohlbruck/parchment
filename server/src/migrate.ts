import 'dotenv/config'
import { migrate } from 'drizzle-orm/neon-http/migrator'
import { db, connection } from './db'

await migrate(db, { migrationsFolder: 'drizzle' })

// TODO: Not working
await connection.end()
