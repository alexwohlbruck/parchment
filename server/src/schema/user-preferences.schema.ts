import { relations } from 'drizzle-orm'
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { NavigationPreferencesPatch } from '../types/navigation-preferences.types'
import { users } from './users.schema'

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  language: text('language').default('en-US').notNull(),
  unitSystem: text('unit_system').default('metric').notNull(),
  navigation: jsonb('navigation').$type<NavigationPreferencesPatch>(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const userPreferencesRelations = relations(userPreferences, ({ one }) => ({
  user: one(users),
}))

export type UserPreferences = typeof userPreferences.$inferSelect
export type NewUserPreferences = typeof userPreferences.$inferInsert
