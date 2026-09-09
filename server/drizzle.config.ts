import { defineConfig } from 'drizzle-kit'
import { dbUrl } from './src/db'

export default defineConfig({
  dbCredentials: {
    url: dbUrl,
  },
  schema: './src/schema/*',
  dialect: 'postgresql',
  verbose: true,
  strict: true,
  out: './drizzle',
})
