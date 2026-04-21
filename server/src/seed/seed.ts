import { db, connection } from '../db'
import { users as usersSchema } from '../schema/users.schema'
import { usersToRoles } from '../schema/users-roles.schema'
import { syncPermissionsAndRoles } from './sync-permissions'

/**
 * Populate the DB with initial data that is required for the app to work properly,
 * such as permissions and roles.
 * Run this script whenever updating roles or permissions using `bun seed`
 */

await syncPermissionsAndRoles()
console.info('✅ Permissions and roles synced')

// Insert initial user if none exist. Display name (first/last) is metadata-
// encrypted under the user's seed, which the seed script doesn't have — the
// user sets it themselves after first login via PATCH /users/me/profile.
const users = await db.select().from(usersSchema).limit(1)
if (users.length === 0) {
  const email = (process.env.APP_TESTER_EMAIL ?? process.env.SEED_EMAIL ?? process.argv[2]) || 'alexwohlbruck@gmail.com'
  const picture = (process.env.SEED_PICTURE ?? process.argv[3]) || 'https://github.com/alexwohlbruck.png'

  const [user] = await db
    .insert(usersSchema)
    .values({
      id: '1',
      email: email!,
      picture: picture!,
    })
    .returning()

  console.info(`✅ Inserted admin user ${email}`)

  await db.insert(usersToRoles).values({
    userId: user.id,
    roleId: 'admin',
  })

  console.info(`✅ Assigned admin role to ${email}`)
}

console.log('Seed finished')

await connection.end()
