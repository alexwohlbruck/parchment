import type { AskQuota } from '../../types/ask.types'
import type { ChatUsage, LanguageModelCapability } from '../../types/language-model.types'

export const DEFAULT_MONTHLY_QUESTIONS = 200

export interface AskUsageTotals {
  promptTokens: number
  completionTokens: number
  cost: number
}

/** The UTC calendar month a question counts against, as `YYYY-MM`. */
export function usageMonth(at: Date): string {
  return at.toISOString().slice(0, 7)
}

export function monthResetsAt(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
}

/** Questions per user per month on the system key; 0 means unlimited. */
export function monthlyQuestionAllowance(value: string | undefined): number {
  const parsed = Number(value?.trim() || NaN)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MONTHLY_QUESTIONS
}

export function askQuota(used: number, limit: number, at: Date): AskQuota | null {
  if (limit === 0) return null
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: monthResetsAt(at).toISOString(),
  }
}

/** Wraps a model so every call's usage adds up into `totals`. */
export function meterModel(model: LanguageModelCapability): {
  model: LanguageModelCapability
  totals: AskUsageTotals
} {
  const totals: AskUsageTotals = { promptTokens: 0, completionTokens: 0, cost: 0 }
  const add = (usage: ChatUsage | undefined) => {
    if (!usage) return
    totals.promptTokens += usage.promptTokens
    totals.completionTokens += usage.completionTokens
    totals.cost += usage.cost ?? 0
  }
  return {
    totals,
    model: {
      async complete(request) {
        const response = await model.complete(request)
        add(response.usage)
        return response
      },
    },
  }
}
