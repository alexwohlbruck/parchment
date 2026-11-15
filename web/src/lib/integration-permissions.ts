import { PermissionId } from '@/types/auth.types'
import {
  IntegrationScope,
  type IntegrationDefinition,
  type IntegrationRecord,
} from '@/types/integrations.types'

/** The permission that writes integrations at one scope, matching the server's check. */
export function writePermissionForScope(scope: IntegrationScope): PermissionId {
  return scope === IntegrationScope.SYSTEM
    ? PermissionId.INTEGRATIONS_WRITE_SYSTEM
    : PermissionId.INTEGRATIONS_WRITE_USER
}

export function canConfigureScope(
  scope: IntegrationScope,
  hasPermission: (permission: PermissionId) => boolean,
): boolean {
  return hasPermission(writePermissionForScope(scope))
}

/** The scope a stored row lives at. Only an integration offered at both needs the row to say. */
export function recordScope(
  integration: Pick<IntegrationDefinition, 'scope'>,
  record: Pick<IntegrationRecord, 'userId'>,
): IntegrationScope {
  if (integration.scope.length === 1) return integration.scope[0]
  return record.userId ? IntegrationScope.USER : IntegrationScope.SYSTEM
}
