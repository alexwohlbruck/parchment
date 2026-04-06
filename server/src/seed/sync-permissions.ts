import { db } from '../db'
import { permissions as permissionsSchema } from '../schema/permissions.schema'
import { roles as rolesSchema } from '../schema/roles.schema'
import { roleToPermissions } from '../schema/roles-permissions.schema'
import { usersToRoles } from '../schema/users-roles.schema'
import { permissions } from './permissions'
import { roles } from './roles'

/**
 * Synchronize permissions and roles from code definitions to the database.
 * Safe to call on every server startup — it preserves existing user-role
 * assignments while ensuring the permission and role tables match code.
 * Wrapped in a transaction to prevent a window with no permissions.
 */
export async function syncPermissionsAndRoles() {
  await db.transaction(async (tx) => {
    // Snapshot existing user-role assignments so we can restore them
    const originalRoleAssignments = await tx.select().from(usersToRoles)

    // Recreate permissions and roles from code definitions
    await tx.delete(roleToPermissions)
    await tx.delete(usersToRoles)
    await tx.delete(rolesSchema)
    await tx.delete(permissionsSchema)

    await tx.insert(permissionsSchema).values(permissions)
    await tx.insert(rolesSchema).values(roles)

    // Assign permissions to roles
    for (const role of roles) {
      const perms = role.permissions === '*' ? permissions.map(p => p.id) : role.permissions
      for (const permissionId of perms) {
        await tx.insert(roleToPermissions).values({
          roleId: role.id,
          permissionId,
        })
      }
    }

    // Restore user-role assignments, filtering out any that reference removed roles
    const validRoleIds = new Set(roles.map(r => r.id))
    const validAssignments = originalRoleAssignments.filter(
      a => validRoleIds.has(a.roleId),
    )
    if (validAssignments.length) {
      await tx.insert(usersToRoles).values(validAssignments)
    }
  })
}
