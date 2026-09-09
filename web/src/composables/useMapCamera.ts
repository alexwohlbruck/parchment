import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import type { MapCamera } from '@/types/map.types'

export function useMapCamera() {
  const mapStore = useMapStore()
  const { mapCamera: camera } = storeToRefs(mapStore)

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
