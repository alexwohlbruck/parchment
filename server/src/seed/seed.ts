import { db, connection } from '../db'
import { permissions as permissionsSchema } from '../schema/permission.schema'
import { roles as rolesSchema } from '../schema/role.schema'
import { roleToPermissions } from '../schema/role-permission.schema'
import { usersToRoles } from '../schema/user-role.schema'
import { permissions } from './permissions'
import { roles } from './roles'

/**
 * Populate the DB with initial data that is required for the app to work properly,
 * such as permissions and roles.
 * Run this script whenever updating roles or permissions using `bun seed`
 */

// Clean database
const originalRoleAssignments = await db.select().from(usersToRoles)
await db.delete(roleToPermissions)
await db.delete(usersToRoles)
await db.delete(rolesSchema)
await db.delete(permissionsSchema)

// Create permissions and roles
const permissionsCount = (
  await db.insert(permissionsSchema).values(permissions).returning()
).length

console.info(`✅ Inserted ${permissionsCount} permissions`)

const rolesCount = (await db.insert(rolesSchema).values(roles).returning())
  .length

console.info(`✅ Inserted ${rolesCount} roles`)

// Assign permissions to roles
for (const role of roles) {
  if (role.permissions === '*') {
    for (const permission of permissions) {
      await db.insert(roleToPermissions).values({
        roleId: role.id,
        permissionId: permission.id,
      })
    }
    console.info(
      `✅ Assigned all ${permissions.length} permissions to role ${role.id}`,
    )
  } else {
    for (const permission of role.permissions) {
      await db.insert(roleToPermissions).values({
        roleId: role.id,
        permissionId: permission,
      })
    }
    console.info(
      `✅ Assigned ${role.permissions.length} permissions to role ${role.id}`,
    )
  }
}

// Reassign roles to users
// TODO: Instead of deleting all roles assignments and recreating, create a diffing algorithm and only update what has changed
if (originalRoleAssignments.length) {
  const insertedRoleAssignments = await db
    .insert(usersToRoles)
    .values(originalRoleAssignments)
    .returning()

  const uniqueUsersCount = new Set(
    insertedRoleAssignments.map((role) => role.userId),
  ).size
  const uniqueRolesCount = new Set(
    insertedRoleAssignments.map((role) => role.roleId),
  ).size

  console.info(
    `✅ Assigned ${uniqueRolesCount} roles to ${uniqueUsersCount} users`,
  )
}

console.log('Seed finished')

await connection.close()
