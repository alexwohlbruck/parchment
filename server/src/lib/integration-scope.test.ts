import { describe, expect, test } from 'bun:test'
import { canWriteRecord, resolveCreateScope } from './integration-scope'
import { IntegrationScope } from '../types/integration.types'

const { SYSTEM, USER } = IntegrationScope

describe('resolveCreateScope', () => {
  test('defaults to personal when both are offered', () => {
    expect(resolveCreateScope([SYSTEM, USER])).toBe(USER)
    expect(resolveCreateScope([SYSTEM, USER], SYSTEM)).toBe(SYSTEM)
  })

  test('uses the only scope offered and rejects any other', () => {
    expect(resolveCreateScope([SYSTEM])).toBe(SYSTEM)
    expect(resolveCreateScope([SYSTEM], USER)).toBeNull()
  })
})

describe('canWriteRecord', () => {
  const access = { canWriteUser: true, canWriteSystem: false }

  test('owners write their own rows, not other users\' or the system row', () => {
    expect(canWriteRecord({ userId: 'me' }, 'me', access)).toBe(true)
    expect(canWriteRecord({ userId: 'them' }, 'me', access)).toBe(false)
    expect(canWriteRecord({ userId: null }, 'me', access)).toBe(false)
  })
})
