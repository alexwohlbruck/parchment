import { pgTable, text, integer, bigint, doublePrecision, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { users } from './users.schema'

export const askUsage = pgTable(
  'ask_usage',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** UTC calendar month, `YYYY-MM`. */
    month: text('month').notNull(),
    /** Whose OpenRouter key paid: `own` or `system`. */
    keySource: text('key_source').notNull(),
    questions: integer('questions').notNull().default(0),
    promptTokens: bigint('prompt_tokens', { mode: 'number' }).notNull().default(0),
    completionTokens: bigint('completion_tokens', { mode: 'number' }).notNull().default(0),
    /** OpenRouter credits (USD). */
    cost: doublePrecision('cost').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.month, t.keySource] })],
)

export type AskUsageRow = typeof askUsage.$inferSelect
