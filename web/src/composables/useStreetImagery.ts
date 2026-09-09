import { ref, watch, onUnmounted, type Ref } from 'vue'
import axios from 'axios'
import { api } from '@/lib/api'
import type { StreetImageryPreview } from '@/types/place.types'

export interface Coordinates {
  lat: number
  lng: number
}

/**
 * Resolve the nearest street-level image to a coordinate (via Mapillary).
 * Re-fetches whenever the coordinate changes; aborts any in-flight request so
 * stale previews never land on a newer place.
 */
export function useStreetImagery(coords: Ref<Coordinates | null>) {
  const preview = ref<StreetImageryPreview | null>(null)
  const loading = ref(false)

  let controller = new AbortController()
  onUnmounted(() => controller.abort())

  watch(
    coords,
    async (c) => {
      controller.abort()
      controller = new AbortController()
      const signal = controller.signal

      preview.value = null

      if (!c) return

      loading.value = true
      try {
        const { data } = await api.get<{ preview: StreetImageryPreview | null }>(
          '/places/street-imagery',
          { params: { lat: c.lat, lng: c.lng }, signal },
        )
        if (!signal.aborted) preview.value = data.preview
      } catch (e) {
        if (axios.isCancel(e)) return
        preview.value = null
      } finally {
        if (!signal.aborted) loading.value = false
      }
    },
    { immediate: true },
  )

  return { preview, loading }
}
