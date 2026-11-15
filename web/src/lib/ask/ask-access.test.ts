import { describe, expect, test } from 'vitest'
import { isAskOffered } from './ask-access'

describe('isAskOffered', () => {
  test('offers Ask when it can run, or to someone who could unlock it', () => {
    expect(isAskOffered({ allowed: true, keySource: 'own' })).toBe(true)
    expect(isAskOffered({ allowed: false, reason: 'not-permitted' })).toBe(true)
    expect(isAskOffered({ allowed: false, reason: 'quota-exceeded', limit: 200, resetsAt: '2026-12-01' })).toBe(true)
  })

  test('hides Ask with no key on the server, or when turned off', () => {
    expect(isAskOffered({ allowed: false, reason: 'not-configured' })).toBe(false)
    expect(isAskOffered({ allowed: false, reason: 'turned-off' })).toBe(false)
    expect(isAskOffered(null)).toBe(false)
  })
})
