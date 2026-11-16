import { describe, test, expect } from 'vitest'
import { PermissionId } from '@server/types/auth.types'
import { IntegrationScope } from '@server/types/integration.types'
import { canConfigureScope, recordScope } from './integration-permissions'

function holder(...permissions: PermissionId[]) {
  return (permission: PermissionId) => permissions.includes(permission)
}

// The alpha role: integrations:write:user plus read-only system access.
const alpha = holder(
  PermissionId.INTEGRATIONS_READ_USER,
  PermissionId.INTEGRATIONS_WRITE_USER,
  PermissionId.INTEGRATIONS_READ_SYSTEM,
)

describe('canConfigureScope', () => {
  test('a read-only admin still configures its own integrations', () => {
    expect(canConfigureScope(IntegrationScope.USER, alpha)).toBe(true)
    expect(canConfigureScope(IntegrationScope.SYSTEM, alpha)).toBe(false)
  })
})

describe('recordScope', () => {
  const both = { scope: [IntegrationScope.SYSTEM, IntegrationScope.USER] }

  test('an integration offered at both scopes reads it from the row owner', () => {
    expect(recordScope(both, { userId: 'u1' })).toBe(IntegrationScope.USER)
    expect(recordScope(both, { userId: null })).toBe(IntegrationScope.SYSTEM)
  })

  test('a single-scope integration ignores the row', () => {
    expect(recordScope({ scope: [IntegrationScope.USER] }, { userId: null })).toBe(
      IntegrationScope.USER,
    )
  })
})
