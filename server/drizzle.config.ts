import { defineConfig } from 'drizzle-kit'
import { dbUrl } from './src/db'
export default defineConfig({
  schema: './src/schema/*',
  driver: 'pg',
  dbCredentials: {
    connectionString: dbUrl!,
  },
  verbose: true,
  strict: true,
  out: './drizzle',
})
