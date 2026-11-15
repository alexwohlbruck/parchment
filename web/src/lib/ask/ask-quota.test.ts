import { describe, expect, it } from 'vitest'
import { formatResetDay } from './ask-quota'

describe('formatResetDay', () => {
  it('names the UTC day the allowance refills', () => {
    expect(formatResetDay('2026-12-01T00:00:00.000Z', 'en-US')).toBe('December 1')
    expect(formatResetDay('2027-01-01T00:00:00.000Z', 'es-ES')).toBe('1 de enero')
  })
})
