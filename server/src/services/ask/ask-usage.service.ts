import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { askUsage } from '../../schema/ask-usage.schema'
import { usageMonth, type AskUsageTotals } from '../../lib/ask/ask-usage'
import type { AskKeySource } from '../../types/ask.types'

export async function recordAskQuestion(
  userId: string,
  keySource: AskKeySource,
  totals: AskUsageTotals,
  at = new Date(),
): Promise<void> {
  await db
    .insert(askUsage)
    .values({ userId, month: usageMonth(at), keySource, questions: 1, ...totals, updatedAt: at })
    .onConflictDoUpdate({
      target: [askUsage.userId, askUsage.month, askUsage.keySource],
      set: {
        questions: sql`${askUsage.questions} + 1`,
        promptTokens: sql`${askUsage.promptTokens} + ${totals.promptTokens}`,
        completionTokens: sql`${askUsage.completionTokens} + ${totals.completionTokens}`,
        cost: sql`${askUsage.cost} + ${totals.cost}`,
        updatedAt: at,
      },
    })
}

export async function questionsAsked(
  userId: string,
  keySource: AskKeySource,
  at = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ questions: askUsage.questions })
    .from(askUsage)
    .where(
      and(
        eq(askUsage.userId, userId),
        eq(askUsage.month, usageMonth(at)),
        eq(askUsage.keySource, keySource),
      ),
    )
    .limit(1)
  return row?.questions ?? 0
}
