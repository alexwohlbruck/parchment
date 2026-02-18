import { onUnmounted } from 'vue'
import { mapEventBus } from '@/lib/eventBus'
import type { MapEvents } from '@/types/map.types'

export function useMapListener<K extends keyof MapEvents>(
  event: K,
  handler: (data: MapEvents[K]) => void,
  options?: {
    /**
     * If true, this handler will override all other handlers for this event
     * and prevent them from firing. Useful for context-specific overrides
     * (e.g., directions page overriding default POI navigation)
     */
    override?: boolean
  },
) {
  if (options?.override) {
    mapEventBus.setOverride(event, handler)
  } else {
    mapEventBus.on(event, handler)
  }

  onUnmounted(() => {
    mapEventBus.off(event, handler)
  })

  return {
    off: () => mapEventBus.off(event, handler),
  }
}
