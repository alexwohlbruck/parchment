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

// Insert initial user if none exist.
const users = await db.select().from(usersSchema).limit(1)
if (users.length === 0) {
  // Use env (e.g. APP_TESTER_EMAIL for e2e tests), then argv, then defaults
  const firstName = (process.env.SEED_FIRST_NAME ?? process.argv[2]) || 'Alex'
  const lastName = (process.env.SEED_LAST_NAME ?? process.argv[3]) || 'Wohlbruck'
  const email = (process.env.APP_TESTER_EMAIL ?? process.env.SEED_EMAIL ?? process.argv[4]) || 'alexwohlbruck@gmail.com'
  const picture = (process.env.SEED_PICTURE ?? process.argv[5]) || 'https://github.com/alexwohlbruck.png'

  const [user] = await db
    .insert(usersSchema)
    .values({
      id: '1',
      firstName: firstName!,
      lastName: lastName!,
      email: email!,
      picture: picture!,
    })
    .returning()

  console.info(`✅ Inserted user ${firstName} ${lastName}`)

  await db.insert(usersToRoles).values({
    userId: user.id,
    roleId: 'admin',
  })

  console.info(`✅ Assigned admin role to ${firstName} ${lastName}`)
}

console.log('Seed finished')

await connection.end()
