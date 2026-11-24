import { expect, test } from 'vitest'
import { passkeyDeleteRisk } from './passkey-delete-risk'

test('a passkey without an unlock slot only costs sign-in', () => {
  expect(passkeyDeleteRisk('a', new Set(['b']), false)).toBe('sign-in')
})

test('the last unlocking passkey is the only way back until the words are confirmed saved', () => {
  expect(passkeyDeleteRisk('a', new Set(['a']), false)).toBe('last-unlock')
  expect(passkeyDeleteRisk('a', new Set(['a']), undefined)).toBe('last-unlock')
  expect(passkeyDeleteRisk('a', new Set(['a']), true)).toBe('unlock')
})

test('another unlocking passkey keeps a way back', () => {
  expect(passkeyDeleteRisk('a', new Set(['a', 'b']), false)).toBe('unlock')
})
