import { PermissionId } from '@/types/auth.types'
import {
  IntegrationScope,
  type IntegrationDefinition,
} from '@/types/integrations.types'

/**
 * Which write permission a given integration requires to be configured.
 *
 * Mirrors the scope check the server applies on POST/PATCH/DELETE
 * `/integrations` (see `integration.controller.ts`): system-scoped
 * integrations need `integrations:write:system`, user-scoped ones need
 * `integrations:write:user`. System wins when a definition declares both,
 * matching the server's precedence.
 *
 * Returns `null` for a definition with no scope — nothing is configurable.
 */
export function requiredWritePermission(
  integration: Pick<IntegrationDefinition, 'scope'>,
): PermissionId | null {
  if (integration.scope?.includes(IntegrationScope.SYSTEM)) {
    return PermissionId.INTEGRATIONS_WRITE_SYSTEM
  }
  if (integration.scope?.includes(IntegrationScope.USER)) {
    return PermissionId.INTEGRATIONS_WRITE_USER
  }
  return null
}

/**
 * Whether the permissions a user holds allow configuring this integration.
 *
 * A read-only admin role (e.g. alpha) holds `integrations:read:system` but
 * not `integrations:write:system` — it must still be able to connect its own
 * personal integrations like the OpenStreetMap account.
 */
export function canConfigureIntegration(
  integration: Pick<IntegrationDefinition, 'scope'>,
  hasPermission: (permission: PermissionId) => boolean,
): boolean {
  const required = requiredWritePermission(integration)
  return required !== null && hasPermission(required)
}
