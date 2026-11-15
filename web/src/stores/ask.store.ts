import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { AskAccess, AskCitation, AskEvent, AskTurn } from '@/types/ask.types'
import type { IsochroneGeometry } from '@server/types/isochrone.types'
import type { QueryIntent } from '@/types/search.types'

export interface AskStep {
  id: string
  label: string
  status: 'running' | 'done' | 'failed'
}

export interface AskExchange {
  question: string
  steps: AskStep[]
  text: string
  places: AskCitation[]
  /** The travel-time area a question like "within a 10 min walk" searched. */
  reach?: IsochroneGeometry
  browse?: QueryIntent
  status: 'running' | 'done' | 'error'
  error?: string
}

export const useAskStore = defineStore('ask', () => {
  const access = ref<AskAccess | null>(null)
  const exchanges = shallowRef<AskExchange[]>([])

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
      status: 'running',
    }
    exchanges.value = followUp ? [...exchanges.value, exchange] : [exchange]
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
      case 'reach':
        updateCurrent(exchange => ({ ...exchange, reach: event.geometry }))
        break
      case 'answer':
        updateCurrent(exchange => ({
          ...exchange,
          text: event.text,
          places: event.places,
          browse: event.browse,
        }))
        break
      case 'error':
        fail(event.message)
        break
      case 'done':
        updateCurrent(exchange =>
          exchange.status === 'running' ? { ...exchange, status: 'done' } : exchange,
        )
        break
    }
  }

  function fail(message: string) {
    updateCurrent(exchange => ({ ...exchange, status: 'error', error: message }))
  }

  function reset() {
    exchanges.value = []
  }

  return { access, exchanges, current, isRunning, history, start, apply, fail, reset }
})
