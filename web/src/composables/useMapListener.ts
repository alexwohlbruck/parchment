import { onUnmounted } from 'vue'
import { useMapService } from '@/services/map.service'
import type { MapEvents } from '@/types/map.types'

export function useMapListener<K extends keyof MapEvents>(
  event: K,
  handler: (data: MapEvents[K]) => void,
) {
  const mapService = useMapService()

  mapService.on(event, handler)

  onUnmounted(() => {
    mapService.off(event, handler)
  })

  return {
    off: () => mapService.off(event, handler), // Optional: allows manual cleanup
  }
}
