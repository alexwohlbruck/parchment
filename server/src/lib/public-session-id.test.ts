import { describe, test, expect } from 'bun:test'
import { publicSessionId } from './public-session-id'

describe('publicSessionId', () => {
  test('is stable for a session', () => {
    expect(publicSessionId('abc')).toBe(publicSessionId('abc'))
  })

  test('differs between sessions and never contains the token', () => {
    const id = publicSessionId('secret-token')
    expect(id).not.toBe(publicSessionId('other-token'))
    expect(id).not.toContain('secret-token')
  })
})
