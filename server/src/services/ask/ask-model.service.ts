import { integrationManager } from '../integrations'
import { OpenRouterIntegration } from '../integrations/openrouter-integration'
import { getPermissions, hasPermission } from '../auth.service'
import { IntegrationCapabilityId } from '../../types/integration.enums'
import { PermissionId } from '../../types/auth.types'
import type { LanguageModelCapability } from '../../types/language-model.types'

export type AskAccess =
  | { allowed: true; model: LanguageModelCapability; keySource: 'own' | 'system' }
  | { allowed: false; reason: 'not-configured' | 'not-permitted' }

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

/** A user's own key always works; the system key needs the premium permission. */
export async function resolveAskAccess(userId: string): Promise<AskAccess> {
  const own = configuredModel(userId)
  if (own) return { allowed: true, model: own, keySource: 'own' }

  const system = configuredModel(null) ?? modelFromEnv()
  if (!system) return { allowed: false, reason: 'not-configured' }

  const permitted = hasPermission(
    await getPermissions(userId),
    PermissionId.PREMIUM_ASK,
  )
  return permitted
    ? { allowed: true, model: system, keySource: 'system' }
    : { allowed: false, reason: 'not-permitted' }
}
