import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const permissions = pgTable('permission', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
})

export type Permission = typeof permissions.$inferSelect
export type NewPermission = typeof permissions.$inferInsert
