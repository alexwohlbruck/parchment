import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/user'

export async function fetchUser(userId: string) {
  return (await db.select().from(users).where(eq(users.id, userId)))[0]
}

export async function fetchUserByEmail(email: string) {
  return (await db.select().from(users).where(eq(users.email, email)))[0]
}
