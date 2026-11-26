import { ref, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'

/** Loads `fetch(query)` whenever the query changes, dropping stale answers. Null query or failure leaves `data` null. */
export function useBookingData<Q, T>(
  query: MaybeRefOrGetter<Q | null>,
  fetch: (query: Q, signal: AbortSignal) => Promise<T>,
) {
  const data = shallowRef<T | null>(null)
  const loading = ref(false)

  watch(
    () => JSON.stringify(toValue(query)),
    (_key, _old, onCleanup) => {
      const current = toValue(query)
      data.value = null
      loading.value = false
      if (!current) return
      const controller = new AbortController()
      onCleanup(() => controller.abort())
      loading.value = true
      fetch(current, controller.signal)
        .then((result) => (data.value = result))
        .catch(() => (data.value = null))
        .finally(() => {
          if (!controller.signal.aborted) loading.value = false
        })
    },
    { immediate: true },
  )

  return { data, loading }
}
