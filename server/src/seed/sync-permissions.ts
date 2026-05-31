import { eq } from 'drizzle-orm'
import { db } from '../db'
import { permissions as permissionsSchema } from '../schema/permissions.schema'
import { roles as rolesSchema } from '../schema/roles.schema'
import { roleToPermissions } from '../schema/roles-permissions.schema'
import { permissions } from './permissions'
import { roles } from './roles'

/**
 * Idempotent sync of code-defined permissions and roles to the database.
 *
 * - Permissions are upserted (never deleted — custom-assigned ones survive).
 * - Default roles are upserted with `isDefault: true` (never deleted).
 * - Default role-permission mappings (`isDefault = true`) are rebuilt from
 *   code each startup. Custom mappings (`isDefault = false`) added by admins
 *   through the UI are left untouched.
 * - User-role assignments are never modified.
 */
export async function syncPermissionsAndRoles() {
  await db.transaction(async (tx) => {
    // 1. Upsert permissions — add new ones, never delete existing
    for (const perm of permissions) {
      await tx
        .insert(permissionsSchema)
        .values({ id: perm.id, name: perm.name })
        .onConflictDoUpdate({
          target: permissionsSchema.id,
          set: { name: perm.name },
        })
    }

    // 2. Upsert default roles — add new ones, update name/description
    for (const role of roles) {
      await tx
        .insert(rolesSchema)
        .values({
          id: role.id,
          name: role.name,
          description: role.description,
          isDefault: true,
        })
        .onConflictDoUpdate({
          target: rolesSchema.id,
          set: {
            name: role.name,
            description: role.description,
            isDefault: true,
          },
        })
    }

    // 3. Rebuild default role-permission mappings only.
    //    Delete all isDefault=true rows, then reinsert from code.
    //    Custom mappings (isDefault=false) are preserved.
    await tx
      .delete(roleToPermissions)
      .where(eq(roleToPermissions.isDefault, true))

    // Fetch all permission IDs in the DB for the admin '*' wildcard
    const allDbPermissions = await tx.select().from(permissionsSchema)
    const allPermissionIds = allDbPermissions.map((p) => p.id)

    for (const role of roles) {
      const perms =
        role.permissions === '*'
          ? allPermissionIds
          : role.permissions

      for (const permissionId of perms) {
        await tx
          .insert(roleToPermissions)
          .values({
            roleId: role.id,
            permissionId,
            isDefault: true,
          })
          .onConflictDoUpdate({
            target: [roleToPermissions.roleId, roleToPermissions.permissionId],
            set: { isDefault: true },
          })
      }
    }
  })
}
