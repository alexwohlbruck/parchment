import { db } from '../db'
import { userPreferences, type UserPreferences, type NewUserPreferences } from '../schema/user-preferences.schema'
import { eq, sql } from 'drizzle-orm'
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '../lib/i18n/i18n.types'
import type { NavigationPreferencesPatch } from '../types/navigation-preferences.types'
import type { AskPreferences } from '../types/ask-preferences.types'
import type { AppPreferences } from '../types/app-preferences.types'
import { resolveAskPreferences } from '../lib/ask/ask-preferences'

const DEFAULT_UNIT_SYSTEM = 'metric'

/**
 * Language to write an email in for `userId`. The user's saved preference wins;
 * otherwise fall back to `requestLanguage` — the language of the request that
 * triggered the send, which for a brand-new account is the only signal there is.
 *
 * Never throws: a preferences lookup failing should not stop an email going out.
 */
export async function resolveEmailLanguage(
  userId: string | null,
  requestLanguage: Language = DEFAULT_LANGUAGE,
): Promise<Language> {
  if (!userId) return requestLanguage
  try {
    const prefs = await getUserPreferences(userId)
    const saved = prefs?.language
    if (saved && (LANGUAGES as readonly string[]).includes(saved)) {
      return saved as Language
    }
  } catch {
    // Fall through to the request language.
  }
  return requestLanguage
}

export async function getUserPreferences(
  userId: string,
): Promise<UserPreferences | null> {
  const rows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1)
  return rows[0] ?? null
}

export async function getOrCreateUserPreferences(
  userId: string,
): Promise<UserPreferences> {
  const existing = await getUserPreferences(userId)
  if (existing) return existing

  const [inserted] = await db
    .insert(userPreferences)
    .values({
      userId,
      language: DEFAULT_LANGUAGE,
      unitSystem: DEFAULT_UNIT_SYSTEM,
    })
    .returning()
  if (!inserted) throw new Error('Failed to create user preferences')
  return inserted
}

type PreferenceUpdates = Partial<Pick<NewUserPreferences, 'language' | 'unitSystem'>> & {
  navigation?: NavigationPreferencesPatch
  ask?: Partial<AskPreferences>
  app?: AppPreferences
}

const BLOB_COLUMNS = ['navigation', 'ask', 'app'] as const

export async function updateUserPreferences(
  userId: string,
  updates: PreferenceUpdates,
): Promise<UserPreferences> {
  const allowed: Partial<Pick<NewUserPreferences, 'language' | 'unitSystem'>> = {}
  if (updates.language !== undefined) allowed.language = updates.language
  if (updates.unitSystem !== undefined) allowed.unitSystem = updates.unitSystem
  const blobs = Object.fromEntries(
    BLOB_COLUMNS.flatMap((column) => {
      const patch = updates[column]
      return patch && Object.keys(patch).length > 0 ? [[column, patch]] : []
    }),
  ) as Pick<PreferenceUpdates, (typeof BLOB_COLUMNS)[number]>
  if (Object.keys(allowed).length === 0 && Object.keys(blobs).length === 0) {
    return getOrCreateUserPreferences(userId)
  }

  const merges = Object.fromEntries(
    Object.entries(blobs).map(([column, patch]) => [
      column,
      sql`coalesce(${userPreferences[column as (typeof BLOB_COLUMNS)[number]]}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    ]),
  )

  const [updated] = await db
    .update(userPreferences)
    .set({ ...allowed, ...merges, updatedAt: new Date() })
    .where(eq(userPreferences.userId, userId))
    .returning()

  if (updated) return updated

  const [inserted] = await db
    .insert(userPreferences)
    .values({
      userId,
      language: allowed.language ?? DEFAULT_LANGUAGE,
      unitSystem: allowed.unitSystem ?? DEFAULT_UNIT_SYSTEM,
      ...blobs,
    })
    .returning()
  if (!inserted) throw new Error('Failed to create user preferences')
  return inserted
}

/** A user's Ask settings, defaults included. */
export async function getAskPreferences(userId: string): Promise<AskPreferences> {
  return resolveAskPreferences((await getUserPreferences(userId))?.ask)
}
