import { describe, expect, test } from 'bun:test'
import { resolveAskPreferences } from './ask-preferences'
import { DEFAULT_ASK_PREFERENCES } from '../../types/ask-preferences.types'

describe('resolveAskPreferences', () => {
  test('fills what was never saved from the defaults', () => {
    expect(resolveAskPreferences(null)).toEqual(DEFAULT_ASK_PREFERENCES)
    expect(resolveAskPreferences({ webSearch: false })).toEqual({ ...DEFAULT_ASK_PREFERENCES, webSearch: false })
  })

  test('ignores values that are not settings', () => {
    expect(resolveAskPreferences({ enabled: 'no', keepDays: 12, other: true })).toEqual(DEFAULT_ASK_PREFERENCES)
  })

  test('keeps a history length it offers, including forever', () => {
    expect(resolveAskPreferences({ keepDays: 0 }).keepDays).toBe(0)
    expect(resolveAskPreferences({ keepDays: 90 }).keepDays).toBe(90)
  })
})
