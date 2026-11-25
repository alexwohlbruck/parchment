/**
 * DB-backed tests for merging app preference sections.
 *
 * Each client saves only the sections it knows, so the merge happens in
 * Postgres. An app version that predates a section must not erase it.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { users } from '../schema/users.schema'
import { getOrCreateUserPreferences, updateUserPreferences } from './user-preferences.service'
import { toPreferencesResponse } from '../lib/user-preferences'
import { generateId } from '../util'

const RUN_SUFFIX = Math.random().toString(36).slice(2, 8)
let userId = ''

beforeAll(async () => {
  userId = generateId()
  await db.insert(users).values({ id: userId, email: `prefs-${RUN_SUFFIX}@parchment.test` })
  await getOrCreateUserPreferences(userId)
})

afterAll(async () => {
  if (userId) await db.delete(users).where(eq(users.id, userId))
})

describe('app preference sections against the real table', () => {
  test('saving one section keeps the others, including ones the client does not know', async () => {
    await updateUserPreferences(userId, { app: { security: { recoveryWordsSavedFor: 'sign-1' } } })
    await updateUserPreferences(userId, { app: { theme: { accentColor: 'teal' } } })

    const { app } = toPreferencesResponse(await getOrCreateUserPreferences(userId))
    expect(app).toEqual({
      security: { recoveryWordsSavedFor: 'sign-1' },
      theme: { accentColor: 'teal' },
    })
  })

  test('a section sent again replaces only itself', async () => {
    await updateUserPreferences(userId, { app: { security: { recoveryWordsSavedFor: 'sign-2' } } })

    const { app } = toPreferencesResponse(await getOrCreateUserPreferences(userId))
    expect(app.security).toEqual({ recoveryWordsSavedFor: 'sign-2' })
    expect(app.theme).toEqual({ accentColor: 'teal' })
  })
})
