import { db } from '../db'
import { userPreferences, type UserPreferences, type NewUserPreferences } from '../schema/user-preferences.schema'
import { eq } from 'drizzle-orm'
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from '../lib/i18n/i18n.types'

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

export async function updateUserPreferences(
  userId: string,
  updates: Partial<Pick<NewUserPreferences, 'language' | 'unitSystem'>>,
): Promise<UserPreferences> {
  const allowed: Partial<NewUserPreferences> = {}
  if (updates.language !== undefined) allowed.language = updates.language
  if (updates.unitSystem !== undefined) allowed.unitSystem = updates.unitSystem
  if (Object.keys(allowed).length === 0) {
    const prefs = await getOrCreateUserPreferences(userId)
    return prefs
  }

  const [updated] = await db
    .update(userPreferences)
    .set({
      ...allowed,
      updatedAt: new Date(),
    })
    .where(eq(userPreferences.userId, userId))
    .returning()

  if (updated) return updated

  // No row existed, insert
  const [inserted] = await db
    .insert(userPreferences)
    .values({
      userId,
      language: allowed.language ?? DEFAULT_LANGUAGE,
      unitSystem: allowed.unitSystem ?? DEFAULT_UNIT_SYSTEM,
    })
    .returning()
  if (!inserted) throw new Error('Failed to create user preferences')
  return inserted
}
