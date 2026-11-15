import { useSessionStorage } from '@vueuse/core'
import router, { AppRoute } from '@/router'
import { authorizeUrl, codeChallenge, randomToken } from '@/lib/ask/openrouter-pkce'
import { useIntegrationService } from '@/services/integration.service'
import { useAskStore } from '@/stores/ask.store'
import {
  IntegrationCapabilityId,
  IntegrationId,
  IntegrationScope,
} from '@/types/integrations.types'

const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys'

interface PendingConnect {
  verifier: string
  state: string
  returnTo: string
}

const pending = useSessionStorage<PendingConnect | null>('openrouter-connect', null, {
  serializer: { read: JSON.parse, write: JSON.stringify },
})

export function useOpenRouterConnect() {
  const integrationService = useIntegrationService()
  const askStore = useAskStore()

  async function start(returnTo: string) {
    const verifier = randomToken()
    const state = randomToken(16)
    pending.value = { verifier, state, returnTo }
    window.location.assign(
      authorizeUrl({
        callbackUrl: `${window.location.origin}${router.resolve({ name: AppRoute.CONNECT_OPENROUTER }).href}`,
        challenge: await codeChallenge(verifier),
        state,
        keyLabel: 'Parchment',
      }),
    )
  }

  /** Trades the callback's code for a key and saves it as the user's own. Returns where to go next. */
  async function complete(code: string, state: string | undefined): Promise<string> {
    const request = pending.value
    pending.value = null
    if (!request || request.state !== state) throw new Error('state mismatch')

    const response = await fetch(EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: request.verifier, code_challenge_method: 'S256' }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || typeof body?.key !== 'string') throw new Error('exchange failed')

    await integrationService.createIntegration(
      IntegrationId.OPENROUTER,
      { apiKey: body.key },
      [{ id: IntegrationCapabilityId.LANGUAGE_MODEL, active: true }],
      'server-key',
      IntegrationScope.USER,
    )
    askStore.access = null
    return request.returnTo
  }

  return { start, complete }
}
