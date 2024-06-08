import { SQL, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/user.schema'
import { AnyPgColumn } from 'drizzle-orm/pg-core'

function lower(email: AnyPgColumn): SQL {
  return sql`lower(${email})`
}

export async function fetchUser(userId: string) {
  return (await db.select().from(users).where(eq(users.id, userId)))[0]
}

export async function fetchUserByEmail(email: string) {
  return (
    await db
      .select()
      .from(users)
      .where(eq(lower(users.email), email.toLowerCase()))
  )[0]
}
