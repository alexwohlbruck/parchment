import { ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { StayRates } from '@server/types/integration.types'
import { fetchStayRates, type StayRatesQuery } from '@/services/place/stay-rates.service'

/** Live rooms for a stay. `rates` stays null when the place has no priced listing. */
export function useStayRates(query: MaybeRefOrGetter<StayRatesQuery | null>) {
  const rates = shallowRef<StayRates | null>(null)
  const loading = ref(false)

  watch(
    () => JSON.stringify(toValue(query)),
    (_key, _old, onCleanup) => {
      const current = toValue(query)
      rates.value = null
      if (!current) return
      const controller = new AbortController()
      onCleanup(() => controller.abort())
      loading.value = true
      fetchStayRates(current, controller.signal)
        .then((result) => (rates.value = result))
        .catch(() => (rates.value = null))
        .finally(() => {
          if (!controller.signal.aborted) loading.value = false
        })
    },
    { immediate: true },
  )

  return { rates, loading }
}
