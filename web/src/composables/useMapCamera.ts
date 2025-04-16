import { ref, computed } from 'vue'
import { useMapService } from '@/services/map.service'
import type { MapCamera } from '@/types/map.types'

export function useMapCamera() {
  const mapService = useMapService()
  const camera = ref<MapCamera>({
    center: [0, 0],
    zoom: 0,
    bearing: 0,
    pitch: 0,
  })

  function onCameraMove(newCamera: MapCamera) {
    camera.value = newCamera
  }

  const compassTransform = computed(() => {
    const { bearing = 0, pitch = 0 } = camera.value
    return `rotateX(${pitch}deg) rotateZ(${-bearing}deg)`
  })

  return {
    camera,
    onCameraMove,
    compassTransform,
  }
}
