import { db, connection } from './db'
import { permissions } from './schema/permission.schema'
import { roles } from './schema/role.schema'
import { roleToPermissions } from './schema/role-permission.schema'
import { usersToRoles } from './schema/user-role.schema'

await db.insert(roles).values({
  id: 'user',
  name: 'User',
  description: 'A user that can view and browse the map',
})

await db.insert(roles).values({
  id: 'admin',
  name: 'Administrator',
  description:
    'An administrator that can modify the app configuration and behavior',
})

await db.insert(permissions).values({
  id: 'map.view',
  name: 'View map',
})

await db.insert(usersToRoles).values({
  userId: '1',
  roleId: 'admin',
})

await db.insert(roleToPermissions).values({
  roleId: 'admin',
  permissionId: 'map.view',
})

await connection.close()
