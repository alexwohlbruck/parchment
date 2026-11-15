import { integrationManager } from '../integrations'
import { OpenRouterIntegration } from '../integrations/openrouter-integration'
import { getPermissions, hasPermission } from '../auth.service'
import { IntegrationCapabilityId } from '../../types/integration.enums'
import { PermissionId } from '../../types/auth.types'
import type { LanguageModelCapability } from '../../types/language-model.types'
import type { AskAccess } from '../../types/ask.types'
import { askQuota, monthlyQuestionAllowance } from '../../lib/ask/ask-usage'
import { questionsAsked } from './ask-usage.service'
import { getAskPreferences } from '../user-preferences.service'

type Granted<A> = A extends { allowed: true } ? A & { model: LanguageModelCapability } : A
export type AskModelAccess = Granted<AskAccess>

let envModel: LanguageModelCapability | null | undefined

/** A hosting deployment can supply the system key through `OPENROUTER_API_KEY` instead of Settings. */
function modelFromEnv(): LanguageModelCapability | null {
  if (envModel !== undefined) return envModel
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) return (envModel = null)
  const integration = new OpenRouterIntegration()
  integration.initialize({ apiKey, model: process.env.OPENROUTER_MODEL })
  return (envModel = integration.capabilities.languageModel!)
}

function configuredModel(userId: string | null): LanguageModelCapability | null {
  const record = integrationManager
    .getConfiguredIntegrationsByCapability(IntegrationCapabilityId.LANGUAGE_MODEL)
    .find((integration) => (integration.userId ?? null) === userId)
  if (!record) return null
  return (
    integrationManager.getCachedIntegrationInstance(record)?.capabilities
      .languageModel ?? null
  )
}

/**
 * A user's own key always works; the system key needs the premium permission
 * and has a monthly question allowance.
 */
export async function resolveAskAccess(
  userId: string,
  now = new Date(),
): Promise<AskModelAccess> {
  if (!(await getAskPreferences(userId)).enabled) return { allowed: false, reason: 'turned-off' }
  const own = configuredModel(userId)
  if (own) return { allowed: true, model: own, keySource: 'own' }

  const system = configuredModel(null) ?? modelFromEnv()
  if (!system) return { allowed: false, reason: 'not-configured' }

  const permitted = hasPermission(
    await getPermissions(userId),
    PermissionId.PREMIUM_ASK,
  )
  if (!permitted) return { allowed: false, reason: 'not-permitted' }

  const limit = monthlyQuestionAllowance(process.env.ASK_MONTHLY_QUESTIONS)
  const quota = limit ? askQuota(await questionsAsked(userId, 'system', now), limit, now) : null
  if (quota && !quota.remaining) {
    return { allowed: false, reason: 'quota-exceeded', limit, resetsAt: quota.resetsAt }
  }
  return { allowed: true, model: system, keySource: 'system', quota }
}
