import { shallowRef, watch, type Ref } from 'vue'
import { fetchArrivalPoints } from '@/services/place/arrival-points.service'
import { offersArrivalPoints } from '@/lib/directions/arrival-points'
import type { Place } from '@/types/place.types'
import type { AutocompleteResult } from '@/types/search.types'

/** Only the top few big places get their points listed; past that the list is noise. */
const MAX_PARENTS = 2

/** Each search result's arrival points (an airport's terminals, a campus's parking), fetched once per mode. */
export function useArrivalPoints(results: Ref<AutocompleteResult[]>, mode: Ref<string>) {
  const found = shallowRef(new Map<string, Place[]>())
  const asked = new Set<string>()
  const keyFor = (id: string, forMode: string) => `${forMode}:${id}`

  async function load(id: string, forMode: string) {
    const key = keyFor(id, forMode)
    if (asked.has(key)) return
    asked.add(key)
    try {
      const { places: points } = await fetchArrivalPoints({ id }, forMode)
      found.value = new Map(found.value).set(key, points)
    } catch {
      asked.delete(key)
    }
  }

  watch(
    [results, mode],
    ([list, forMode]) => {
      list
        .filter(result => offersArrivalPoints(result, forMode))
        .slice(0, MAX_PARENTS)
        .forEach(result => load(result.id, forMode))
    },
    { immediate: true },
  )

  return {
    pointsFor: (id: string): Place[] => found.value.get(keyFor(id, mode.value)) ?? [],
  }
}
