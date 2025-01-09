import { onUnmounted } from 'vue'
import { mapEventBus } from '@/lib/eventBus'
import type { MapEvents } from '@/types/map.types'

export function useMapListener<K extends keyof MapEvents>(
  event: K,
  handler: (data: MapEvents[K]) => void,
) {
  mapEventBus.on(event, handler)

  onUnmounted(() => {
    mapEventBus.off(event, handler)
  })

  return {
    off: () => mapEventBus.off(event, handler),
  }
}
