import { defineConfig } from 'drizzle-kit'
import { dbUrlLocal } from './src/db'

export default defineConfig({
  dbCredentials: {
    url: dbUrlLocal,
  },
  schema: './src/schema/*',
  dialect: 'postgresql',
  verbose: true,
  strict: true,
  out: './drizzle',
})
