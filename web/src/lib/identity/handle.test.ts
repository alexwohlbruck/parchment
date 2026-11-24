import { describe, expect, test } from 'vitest'
import { isRemoteHandle } from './handle'

describe('isRemoteHandle', () => {
  test('a handle on our server is local', () => {
    expect(isRemoteHandle('bob@parchment.app', 'parchment.app')).toBe(false)
  })

  test('compares domains case-insensitively', () => {
    expect(isRemoteHandle('bob@Parchment.App', 'parchment.app')).toBe(false)
  })

  test('a handle on another server is remote', () => {
    expect(isRemoteHandle('bob@other.example', 'parchment.app')).toBe(true)
  })

  test('treats a different port as another server', () => {
    expect(isRemoteHandle('bob@localhost:5001', 'localhost:5000')).toBe(true)
  })

  test('is local when either domain is unknown', () => {
    expect(isRemoteHandle('bob', 'parchment.app')).toBe(false)
    expect(isRemoteHandle('bob@other.example', '')).toBe(false)
  })
})
