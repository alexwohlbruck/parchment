import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

export const dbUser = process.env.POSTGRES_USER as string
export const dbPassword = process.env.POSTGRES_PASSWORD as string
export const dbHost = process.env.POSTGRES_HOST as string
export const dbName = process.env.POSTGRES_DB as string

export const dbUrl = `postgresql://${dbUser}:${dbPassword}@${dbHost}/${dbName}?sslmode=require`

export const connection = postgres(dbUrl)
export const db = drizzle(connection)
