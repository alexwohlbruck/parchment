/**
 * Unit tests for user preferences.
 *
 * The service is small but has three upsert paths that are easy to get wrong:
 * read-or-create, update-or-insert-if-missing, and the no-op patch that must
 * still return current values rather than writing empty updates. The allowlist
 * on `updates` also matters — an unexpected key must not reach the row.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'
import { DEFAULT_LANGUAGE } from '../lib/i18n/i18n.types'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

const {
  getUserPreferences,
  getOrCreateUserPreferences,
  updateUserPreferences,
  resolveEmailLanguage,
} = await import('./user-preferences.service')

const existingRow = {
  userId: 'user-1',
  language: 'es-ES',
  unitSystem: 'imperial',
}

beforeEach(() => {
  dbMock.reset()
})

describe('getUserPreferences', () => {
  test('returns the stored row', async () => {
    dbMock.queueSelect([existingRow])

    expect(await getUserPreferences('user-1')).toEqual(existingRow)
  })

  test('returns null when the user has no preferences yet', async () => {
    dbMock.queueSelect([])

    expect(await getUserPreferences('user-1')).toBeNull()
  })
})

describe('getOrCreateUserPreferences', () => {
  test('returns the existing row without writing', async () => {
    dbMock.queueSelect([existingRow])

    const prefs = await getOrCreateUserPreferences('user-1')

    expect(prefs).toEqual(existingRow)
    expect(dbMock.insertCount).toBe(0)
  })

  test('creates a row with defaults when none exists', async () => {
    dbMock.queueSelect([])
    dbMock.setReturningRows([
      { userId: 'user-1', language: DEFAULT_LANGUAGE, unitSystem: 'metric' },
    ])

    const prefs = await getOrCreateUserPreferences('user-1')

    expect(dbMock.inserted[0]).toEqual({
      userId: 'user-1',
      language: DEFAULT_LANGUAGE,
      unitSystem: 'metric',
    })
    expect(prefs.unitSystem).toBe('metric')
  })

  test('throws when the insert returns nothing', async () => {
    dbMock.queueSelect([])
    dbMock.setReturningRows([])

    await expect(getOrCreateUserPreferences('user-1')).rejects.toThrow(
      'Failed to create user preferences',
    )
  })
})

describe('updateUserPreferences', () => {
  test('updates the supplied fields', async () => {
    dbMock.setReturningRows([{ ...existingRow, unitSystem: 'metric' }])

    const prefs = await updateUserPreferences('user-1', { unitSystem: 'metric' })

    expect((dbMock.updated[0] as any).unitSystem).toBe('metric')
    expect(prefs.unitSystem).toBe('metric')
  })

  test('stamps updatedAt on every write', async () => {
    dbMock.setReturningRows([existingRow])

    await updateUserPreferences('user-1', { language: 'en-US' })

    expect((dbMock.updated[0] as any).updatedAt).toBeInstanceOf(Date)
  })

  test('ignores keys outside the allowlist', async () => {
    dbMock.setReturningRows([existingRow])

    await updateUserPreferences('user-1', {
      language: 'en-US',
      userId: 'someone-else',
      isAdmin: true,
    } as any)

    const written = dbMock.updated[0] as any
    expect(written.userId).toBeUndefined()
    expect(written.isAdmin).toBeUndefined()
    expect(written.language).toBe('en-US')
  })

  test('an empty patch reads current values instead of writing', async () => {
    dbMock.queueSelect([existingRow])

    const prefs = await updateUserPreferences('user-1', {})

    expect(dbMock.updateCount).toBe(0)
    expect(prefs).toEqual(existingRow)
  })

  test('a patch of only undefined values is treated as empty', async () => {
    dbMock.queueSelect([existingRow])

    const prefs = await updateUserPreferences('user-1', {
      language: undefined,
      unitSystem: undefined,
    })

    expect(dbMock.updateCount).toBe(0)
    expect(prefs).toEqual(existingRow)
  })

  test('inserts when the update matched no row', async () => {
    // First-time writers have no preferences row yet.
    dbMock.queueReturning([])
    dbMock.queueReturning([
      { userId: 'user-1', language: 'en-US', unitSystem: 'metric' },
    ])

    const prefs = await updateUserPreferences('user-1', { language: 'en-US' })

    expect(dbMock.insertCount).toBe(1)
    expect(prefs.language).toBe('en-US')
  })

  test('the fallback insert fills unspecified fields with defaults', async () => {
    dbMock.queueReturning([])
    dbMock.queueReturning([{ userId: 'user-1' }])

    await updateUserPreferences('user-1', { unitSystem: 'imperial' })

    expect(dbMock.inserted[0]).toEqual({
      userId: 'user-1',
      language: DEFAULT_LANGUAGE,
      unitSystem: 'imperial',
    })
  })

  test('throws when the fallback insert returns nothing', async () => {
    dbMock.queueReturning([])
    dbMock.queueReturning([])

    await expect(
      updateUserPreferences('user-1', { language: 'en-US' }),
    ).rejects.toThrow('Failed to create user preferences')
  })
})

describe('resolveEmailLanguage', () => {
  test("prefers the recipient's saved language", async () => {
    dbMock.queueSelect([existingRow])

    expect(await resolveEmailLanguage('user-1', 'en-US')).toBe('es-ES')
  })

  test('falls back to the request language when nothing is saved', async () => {
    dbMock.queueSelect([])

    expect(await resolveEmailLanguage('user-1', 'es-ES')).toBe('es-ES')
  })

  test('ignores a saved value the resources do not cover', async () => {
    dbMock.queueSelect([{ ...existingRow, language: 'fr-FR' }])

    expect(await resolveEmailLanguage('user-1', 'en-US')).toBe('en-US')
  })

  test('skips the lookup entirely for a recipient with no account', async () => {
    expect(await resolveEmailLanguage(null, 'es-ES')).toBe('es-ES')
  })

  test('defaults when the request language is unknown too', async () => {
    dbMock.queueSelect([])

    expect(await resolveEmailLanguage('user-1')).toBe(DEFAULT_LANGUAGE)
  })
})
