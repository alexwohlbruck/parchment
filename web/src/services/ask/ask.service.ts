import { api, apiFetchAuth } from '@/lib/api'
import { i18n, storedLocale } from '@/lib/i18n'
import { createSseParser } from '@/lib/ask/sse-events'
import { useAskStore } from '@/stores/ask.store'
import { useAskHistoryService } from '@/services/ask/ask-history.service'
import { useRoutesStore } from '@/stores/library/routes.store'
import { useCanvasesStore } from '@/stores/library/canvases.store'
import type { AskAccess, AskEvent, AskPoint, AskWhere } from '@/types/ask.types'

let controller: AbortController | null = null

const t = (key: string) =>
  (i18n.global as unknown as { t: (key: string) => string }).t(key)


export function useAskService() {
  const askStore = useAskStore()
  const askHistory = useAskHistoryService()
  const routesStore = useRoutesStore()
  const canvasesStore = useCanvasesStore()

  /** Keeps the library in step with what Ask filed away. */
  function syncLibrary(event: Extract<AskEvent, { type: 'archived' }>) {
    const archivedAt = event.archived ? new Date().toISOString() : null
    if (event.kind === 'route') {
      const route = routesStore.getRouteById(event.id)
      if (route) routesStore.upsertRoute({ ...route, archivedAt })
    } else {
      const canvas = canvasesStore.getCanvasById(event.id)
      if (canvas) canvasesStore.upsertCanvas({ ...canvas, archivedAt })
    }
  }

  function receive(event: AskEvent) {
    if (event.type === 'archived') syncLibrary(event)
    else askStore.apply(event)
  }

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
    where: AskWhere,
    { followUp = false, placeId, point }: { followUp?: boolean; placeId?: string; point?: AskPoint } = {},
  ) {
    cancel()
    const history = followUp ? askStore.history : []
    askStore.start(question, { followUp })
    controller = new AbortController()
    const { signal } = controller

    const auth = apiFetchAuth()
    try {
      const response = await fetch(`${api.defaults.baseURL}/ask`, {
        method: 'POST',
        credentials: auth.credentials,
        headers: {
          ...auth.headers,
          'Content-Type': 'application/json',
          'Accept-Language': storedLocale.value,
        },
        body: JSON.stringify({
          question,
          history,
          placeId,
          point,
          ...where,
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

      const feed = createSseParser<AskEvent>(receive)
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        feed(value)
      }
      askStore.apply({ type: 'done' })
      askHistory.record()
    } catch (error) {
      if (!signal.aborted) askStore.fail(t('ask.error'))
    }
  }

  return { loadAccess, ask, cancel }
}
