/**
 * Unit tests for integration write-permission resolution.
 *
 * Regression cover for the read-only-admin case: a role holding
 * integrations:read:system (alpha) but not integrations:write:system must
 * still be able to configure its own user-scoped integrations.
 */

import { describe, test, expect } from 'vitest'
import { PermissionId } from '@server/types/auth.types'
import {
  IntegrationScope,
  type IntegrationDefinition,
} from '@server/types/integration.types'
import {
  canConfigureIntegration,
  requiredWritePermission,
} from './integration-permissions'

function defWithScope(scope: IntegrationScope[]) {
  return { scope } as Pick<IntegrationDefinition, 'scope'>
}

function holder(...permissions: PermissionId[]) {
  return (permission: PermissionId) => permissions.includes(permission)
}

// Mirrors the alpha role: every premium permission (which includes
// integrations:write:user) plus read-only system access.
const alpha = holder(
  PermissionId.INTEGRATIONS_READ_USER,
  PermissionId.INTEGRATIONS_WRITE_USER,
  PermissionId.INTEGRATIONS_READ_SYSTEM,
)

const admin = holder(
  PermissionId.INTEGRATIONS_READ_USER,
  PermissionId.INTEGRATIONS_WRITE_USER,
  PermissionId.INTEGRATIONS_READ_SYSTEM,
  PermissionId.INTEGRATIONS_WRITE_SYSTEM,
)

describe('requiredWritePermission', () => {
  test('user-scoped integrations require write:user', () => {
    expect(requiredWritePermission(defWithScope([IntegrationScope.USER]))).toBe(
      PermissionId.INTEGRATIONS_WRITE_USER,
    )
  })

  test('system-scoped integrations require write:system', () => {
    expect(
      requiredWritePermission(defWithScope([IntegrationScope.SYSTEM])),
    ).toBe(PermissionId.INTEGRATIONS_WRITE_SYSTEM)
  })

  test('system wins for dual-scoped integrations, matching the server', () => {
    expect(
      requiredWritePermission(
        defWithScope([IntegrationScope.USER, IntegrationScope.SYSTEM]),
      ),
    ).toBe(PermissionId.INTEGRATIONS_WRITE_SYSTEM)
  })

  test('a scopeless definition requires nothing and configures nothing', () => {
    expect(requiredWritePermission(defWithScope([]))).toBeNull()
  })
})

describe('canConfigureIntegration', () => {
  test('read-only system admin can configure user-scoped integrations', () => {
    expect(
      canConfigureIntegration(defWithScope([IntegrationScope.USER]), alpha),
    ).toBe(true)
  })

  test('read-only system admin cannot configure system-scoped integrations', () => {
    expect(
      canConfigureIntegration(defWithScope([IntegrationScope.SYSTEM]), alpha),
    ).toBe(false)
  })

  test('full admin can configure both scopes', () => {
    expect(
      canConfigureIntegration(defWithScope([IntegrationScope.USER]), admin),
    ).toBe(true)
    expect(
      canConfigureIntegration(defWithScope([IntegrationScope.SYSTEM]), admin),
    ).toBe(true)
  })

  test('a user without any integration write permission is locked out', () => {
    const readOnly = holder(
      PermissionId.INTEGRATIONS_READ_USER,
      PermissionId.INTEGRATIONS_READ_SYSTEM,
    )
    expect(
      canConfigureIntegration(defWithScope([IntegrationScope.USER]), readOnly),
    ).toBe(false)
    expect(
      canConfigureIntegration(
        defWithScope([IntegrationScope.SYSTEM]),
        readOnly,
      ),
    ).toBe(false)
  })

  test('a scopeless definition is never configurable', () => {
    expect(canConfigureIntegration(defWithScope([]), admin)).toBe(false)
  })
})
