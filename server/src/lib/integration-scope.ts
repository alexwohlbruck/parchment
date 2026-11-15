import { IntegrationScope } from '../types/integration.types'

export interface IntegrationWriteAccess {
  canWriteUser: boolean
  canWriteSystem: boolean
}

export function canWriteScope(scope: IntegrationScope, access: IntegrationWriteAccess): boolean {
  return scope === IntegrationScope.SYSTEM ? access.canWriteSystem : access.canWriteUser
}

/** Where a new integration is stored. One offering both scopes is personal unless system is asked for. */
export function resolveCreateScope(
  scopes: IntegrationScope[],
  requested?: IntegrationScope,
): IntegrationScope | null {
  if (requested) return scopes.includes(requested) ? requested : null
  if (scopes.includes(IntegrationScope.USER)) return IntegrationScope.USER
  return scopes.includes(IntegrationScope.SYSTEM) ? IntegrationScope.SYSTEM : null
}

/** A stored row is writable by its owner, or by a system admin when it has no owner. */
export function canWriteRecord(
  record: { userId: string | null },
  userId: string,
  access: IntegrationWriteAccess,
): boolean {
  return record.userId
    ? record.userId === userId && access.canWriteUser
    : access.canWriteSystem
}
