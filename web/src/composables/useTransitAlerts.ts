import { ref, watch, computed, type Ref, type ComputedRef } from 'vue'
import { useTransitAlertsStore, alertQueryKey, type AlertQuery } from '@/stores/transit-alerts.store'
import { worstAlert, isInEffect, isUpcoming, sortByRelevance } from '@/lib/transit-alerts'
import type { ServiceAlert } from '@/types/transit.types'

export interface TransitAlerts {
  alerts: Ref<ServiceAlert[]>
  inEffect: ComputedRef<ServiceAlert[]>
  upcoming: ComputedRef<ServiceAlert[]>
  worst: ComputedRef<ServiceAlert | null>
  isLoading: Ref<boolean>
}

/**
 * Alerts for whatever the caller is currently looking at.
 *
 * The query is reactive because every surface that wants alerts learns what to
 * ask for after it mounts — a route page from its store, a trip leg from the
 * plan, a stop board from the widget response. Pass a computed that returns
 * `null` until the ids are known and this stays quiet until then.
 *
 * Splitting `inEffect` from `upcoming` is what lets a page lead with what's
 * happening now and file next weekend's closure below it, the way an agency's
 * own alert page does.
 */
export function useTransitAlerts(
  query: Ref<AlertQuery | null> | ComputedRef<AlertQuery | null>,
): TransitAlerts {
  const store = useTransitAlertsStore()
  const alerts = ref<ServiceAlert[]>([])
  const isLoading = ref(false)

  // Watching the key rather than the object: callers build their query in a
  // computed, which hands back a fresh object on every upstream tick even when
  // the ids are unchanged.
  const key = computed(() => (query.value ? alertQueryKey(query.value) : null))

  watch(
    key,
    async (current) => {
      if (!current || !query.value) {
        alerts.value = []
        isLoading.value = false
        return
      }
      isLoading.value = true
      const result = await store.fetchAlerts(query.value)
      // A late reply from a query we've since navigated away from must not
      // overwrite the current one.
      if (key.value !== current) return
      alerts.value = result
      isLoading.value = false
    },
    { immediate: true },
  )

  // Ordered by relevance here, once, so every surface agrees.
  const inEffect = computed(() => sortByRelevance(alerts.value.filter(a => isInEffect(a))))
  const upcoming = computed(() => sortByRelevance(alerts.value.filter(a => isUpcoming(a))))
  const worst = computed(() => worstAlert(inEffect.value))

  return { alerts, inEffect, upcoming, worst, isLoading }
}
