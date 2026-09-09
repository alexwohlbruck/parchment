import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { mapPoiClickPolicy } from '@/lib/map/map-poi-interaction'

/** Suppress place-like map actions for this component's lifetime. */
export function useMapPoiClickSuppression(
  suppressed: MaybeRefOrGetter<boolean> = true,
) {
  let release: (() => void) | null = null

  const stop = watch(
    () => toValue(suppressed),
    value => {
      release?.()
      release = value ? mapPoiClickPolicy.suppress() : null
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    stop()
    release?.()
  })
}
