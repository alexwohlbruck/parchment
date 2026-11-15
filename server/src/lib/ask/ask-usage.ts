import type { AskQuota } from '../../types/ask.types'
import { PermissionId } from '../../types/auth.types'
import type { ChatUsage, LanguageModelCapability } from '../../types/language-model.types'

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

/** Monthly questions on the system key for each permission, best first. 0 is unlimited. */
export const ASK_ALLOWANCES = [
  { permission: PermissionId.PREMIUM_ASK, env: 'ASK_QUESTIONS_PREMIUM', questions: 1000 },
  { permission: PermissionId.ASK_BASIC, env: 'ASK_QUESTIONS_BASIC', questions: 50 },
  { permission: PermissionId.ASK_TRIAL, env: 'ASK_QUESTIONS_TRIAL', questions: 5 },
] as const

function readAllowance(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim() || NaN)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

/** The best monthly allowance among `permissions`, 0 for unlimited, or null with none. */
export function questionAllowance(
  permissions: readonly string[],
  env: Record<string, string | undefined>,
): number | null {
  const held = ASK_ALLOWANCES.filter(({ permission }) => permissions.includes(permission))
  if (!held.length) return null
  const limits = held.map(({ env: key, questions }) => readAllowance(env[key], questions))
  return limits.includes(0) ? 0 : Math.max(...limits)
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
