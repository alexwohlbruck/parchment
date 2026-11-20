import { describe, test, expect } from 'bun:test'
import { serverOrigin } from '../../config/origins.config'
import { isPublicKey, keyFromUrl, publicUrl } from './storage.service'

describe('publicUrl / keyFromUrl', () => {
  test('serves through the API when no public URL is configured', () => {
    expect(publicUrl('avatars/u1/abc.webp')).toBe(`${serverOrigin}/files/avatars/u1/abc.webp`)
  })

  test('round-trips a key', () => {
    expect(keyFromUrl(publicUrl('avatars/u1/abc.webp'))).toBe('avatars/u1/abc.webp')
  })

  test('ignores URLs we did not issue', () => {
    expect(keyFromUrl('https://github.com/someone.png')).toBeNull()
    expect(keyFromUrl('/users/u1/avatar')).toBeNull()
    expect(keyFromUrl(null)).toBeNull()
  })
})

describe('isPublicKey', () => {
  test('allows avatars', () => {
    expect(isPublicKey('avatars/u1/abc.webp')).toBe(true)
  })

  test('rejects other prefixes and traversal', () => {
    expect(isPublicKey('private/u1/blob')).toBe(false)
    expect(isPublicKey('avatars/../private/blob')).toBe(false)
  })
})
