import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  schema: './src/schema/*',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL_LOCAL!,
  },
  verbose: true,
  strict: true,
  out: './drizzle',
})
