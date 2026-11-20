/**
 * Mint a session for a local admin account without the email or passkey flow,
 * so an agent can call the API or drive the web app as that user.
 *
 * Usage (from server/):
 *   bun run dev:sign-in [email]   # print a session token; defaults to the oldest admin
 *   bun run dev:sign-in --revoke  # delete every session this script has minted
 *
 * A preview reads its env from the worktree root:
 *   bun --env-file=../.env.preview scripts/dev-sign-in.ts
 *
 * Refuses to run unless NODE_ENV is "development" and the database is local.
 * It is a CLI only, never an HTTP route, so nothing about it is reachable over
 * the network. Each run revokes the previous token it minted for that user.
 */

import { and, asc, eq } from 'drizzle-orm'
import { db, connection, dbUrl } from '../src/db'
import { lucia } from '../src/lucia'
import { users } from '../src/schema/users.schema'
import { usersToRoles } from '../src/schema/users-roles.schema'
import { sessions } from '../src/schema/sessions.schema'
import { DEV_SESSION_USER_AGENT, devSignInRefusal } from '../src/lib/dev-sign-in'

function fail(message: string): never {
  console.error(`dev-sign-in: ${message}`)
  process.exit(1)
}

async function findUser(email: string | undefined) {
  if (email) {
    const [user] = await db.select().from(users).where(eq(users.email, email))
    return user
  }
  const [admin] = await db
    .select({ user: users })
    .from(users)
    .innerJoin(usersToRoles, eq(usersToRoles.userId, users.id))
    .where(eq(usersToRoles.roleId, 'admin'))
    .orderBy(asc(users.createdAt))
    .limit(1)
  return admin?.user
}

async function main() {
  const refusal = devSignInRefusal({ nodeEnv: process.env.NODE_ENV, dbUrl })
  if (refusal) fail(`refusing to run: ${refusal}`)

  const args = process.argv.slice(2)

  if (args.includes('--revoke')) {
    const revoked = await db
      .delete(sessions)
      .where(eq(sessions.userAgent, DEV_SESSION_USER_AGENT))
      .returning({ id: sessions.id })
    console.error(`dev-sign-in: revoked ${revoked.length} session(s)`)
    return
  }

  const email = args.find((arg) => !arg.startsWith('-'))
  const user = await findUser(email)
  if (!user) fail(email ? `no user with email ${email}` : 'no admin user found')

  await db
    .delete(sessions)
    .where(
      and(
        eq(sessions.userId, user.id),
        eq(sessions.userAgent, DEV_SESSION_USER_AGENT),
      ),
    )

  const session = await lucia.createSession(user.id, {})
  await db
    .update(sessions)
    .set({ userAgent: DEV_SESSION_USER_AGENT })
    .where(eq(sessions.id, session.id))

  console.error(`dev-sign-in: session for ${user.email}`)
  console.log(session.id)
}

main()
  .catch((error) => fail(error instanceof Error ? error.message : String(error)))
  .finally(() => connection.end())
