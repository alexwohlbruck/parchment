import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { AskAccess, AskEvent, AskExchange, AskThread, AskTripPlan, AskTurn } from '@/types/ask.types'

export const useAskStore = defineStore('ask', () => {
  const access = ref<AskAccess | null>(null)
  const exchanges = shallowRef<AskExchange[]>([])
  /** The open thread, as history knows it. */
  const threadId = ref<string | null>(null)
  const threadCreatedAt = ref(0)
  /** Saved threads, newest first. */
  const threads = shallowRef<AskThread[]>([])

  const current = computed(() => exchanges.value.at(-1) ?? null)
  const isRunning = computed(() => current.value?.status === 'running')

  /** Earlier exchanges as model turns, so a follow-up can refer back to them. */
  const history = computed<AskTurn[]>(() =>
    exchanges.value
      .filter(exchange => exchange.status === 'done')
      .flatMap(exchange => [
        { role: 'user' as const, content: exchange.question },
        {
          role: 'assistant' as const,
          content: [
            exchange.text,
            ...exchange.places.map(({ place }) => `${place.name.value} (${place.id})`),
          ].join('\n'),
        },
      ]),
  )

  function updateCurrent(change: (exchange: AskExchange) => AskExchange) {
    const last = exchanges.value.at(-1)
    if (!last) return
    exchanges.value = [...exchanges.value.slice(0, -1), change(last)]
  }

  function start(question: string, { followUp }: { followUp: boolean }) {
    const exchange: AskExchange = {
      question,
      steps: [],
      text: '',
      places: [],
      startedAt: Date.now(),
      status: 'running',
    }
    if (!followUp || !threadId.value) {
      threadId.value = crypto.randomUUID()
      threadCreatedAt.value = exchange.startedAt
    }
    exchanges.value = followUp ? [...exchanges.value, exchange] : [exchange]
  }

  /** Reopens a thread from history; its trips are planned again when opened. */
  function restore(thread: AskThread) {
    threadId.value = thread.id
    threadCreatedAt.value = thread.createdAt
    exchanges.value = thread.exchanges
  }

  function apply(event: AskEvent) {
    switch (event.type) {
      case 'step':
        updateCurrent(exchange => {
          const { type, ...step } = event
          const known = exchange.steps.some(s => s.id === step.id)
          return {
            ...exchange,
            steps: known
              ? exchange.steps.map(s => (s.id === step.id ? step : s))
              : [...exchange.steps, step],
          }
        })
        break
      case 'canvas':
        updateCurrent(exchange => ({ ...exchange, canvas: { id: event.id, name: event.name } }))
        break
      case 'reach':
        updateCurrent(exchange => ({ ...exchange, reach: event.geometry }))
        break
      case 'trip':
        updateCurrent(exchange => {
          const { type, ...trip } = event
          return { ...exchange, trip }
        })
        break
      case 'answer':
        updateCurrent(exchange => ({
          ...exchange,
          text: event.text,
          places: event.places,
          browse: event.browse,
          followUps: event.followUps,
          sources: event.sources,
        }))
        break
      case 'error':
        fail(event.message)
        break
      case 'done':
        updateCurrent(exchange =>
          exchange.status === 'running' ? { ...exchange, status: 'done', finishedAt: Date.now() } : exchange,
        )
        break
    }
  }

  function setPlan(index: number, plan: AskTripPlan | null) {
    if (!exchanges.value[index]) return
    exchanges.value = exchanges.value.map((exchange, i) => (i === index ? { ...exchange, plan } : exchange))
  }

  function fail(message: string) {
    updateCurrent(exchange => ({ ...exchange, status: 'error', error: message, finishedAt: Date.now() }))
  }

  function reset() {
    exchanges.value = []
    threadId.value = null
  }

  return {
    access,
    exchanges,
    threadId,
    threadCreatedAt,
    threads,
    current,
    isRunning,
    history,
    start,
    restore,
    apply,
    setPlan,
    fail,
    reset,
  }
})
