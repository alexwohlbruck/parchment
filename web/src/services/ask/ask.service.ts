import { api } from '@/lib/api'
import { i18n, storedLocale } from '@/lib/i18n'
import { createSseParser } from '@/lib/ask/sse-events'
import { toLngLat } from '@/lib/geo/lng-lat'
import { useAskStore } from '@/stores/ask.store'
import { useMapStore } from '@/stores/map.store'
import type { AskAccess, AskEvent } from '@/types/ask.types'

let controller: AbortController | null = null

const t = (key: string) =>
  (i18n.global as unknown as { t: (key: string) => string }).t(key)

function requestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': storedLocale.value,
  }
  const authorization = api.defaults.headers.common['Authorization']
  if (typeof authorization === 'string') headers.Authorization = authorization
  return headers
}

export function useAskService() {
  const askStore = useAskStore()
  const mapStore = useMapStore()

  async function loadAccess({ fresh = false } = {}): Promise<AskAccess> {
    if (askStore.access && !fresh) return askStore.access
    const { data } = await api.get<AskAccess>('/ask/access', { silent: true })
    askStore.access = data
    return data
  }

  function cancel() {
    controller?.abort()
    controller = null
  }

  async function ask(
    question: string,
    { followUp = false, placeId }: { followUp?: boolean; placeId?: string } = {},
  ) {
    cancel()
    const history = followUp ? askStore.history : []
    askStore.start(question, { followUp })
    controller = new AbortController()
    const { signal } = controller

    try {
      const response = await fetch(`${api.defaults.baseURL}/ask`, {
        method: 'POST',
        credentials: api.defaults.withCredentials ? 'include' : 'omit',
        headers: requestHeaders(),
        body: JSON.stringify({
          question,
          history,
          placeId,
          ...toLngLat(mapStore.mapCamera.center),
        }),
        signal,
      })
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null)
        if (body?.reason === 'quota-exceeded') {
          askStore.access = { allowed: false, reason: body.reason, limit: body.limit, resetsAt: body.resetsAt }
        }
        askStore.fail(body?.message ?? t('ask.error'))
        return
      }

      const feed = createSseParser<AskEvent>(askStore.apply)
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        feed(value)
      }
      askStore.apply({ type: 'done' })
    } catch (error) {
      if (!signal.aborted) askStore.fail(t('ask.error'))
    }
  }

  return { loadAccess, ask, cancel }
}
