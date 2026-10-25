import { onScopeDispose, ref } from 'vue'
import type { Map as MaplibreMap, MapLibreEvent } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { createSpring, stepAngleSpring } from '@/lib/guidance/spring'

const FOLLOW_ZOOM = 17
const FOLLOW_PITCH = 50
const BEARING_SMOOTH_SEC = 0.35
const USER_GESTURES = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const

export function useGuidanceCamera() {
  const following = ref(true)
  const map = useMapStore().getMapStrategy()?.mapInstance as MaplibreMap | undefined
  const bearing = createSpring(map?.getBearing() ?? 0)
  let frame: number | null = null
  let lastFrameMs = performance.now()

  const onGesture = (event: MapLibreEvent & { originalEvent?: Event }) => {
    if (event.originalEvent) following.value = false
  }

  function loop(nowMs: number) {
    frame = requestAnimationFrame(loop)
    const dt = Math.min(0.1, (nowMs - lastFrameMs) / 1000)
    lastFrameMs = nowMs
    if (!map || !following.value) return
    const puck = guidanceEngine.sample()
    if (!puck) return
    map.jumpTo({
      center: [puck.position.lng, puck.position.lat],
      bearing: stepAngleSpring(bearing, puck.bearing, BEARING_SMOOTH_SEC, dt),
    })
  }

  function resume() {
    if (!map) return
    bearing.value = map.getBearing()
    bearing.velocity = 0
    following.value = true
    map.jumpTo({ zoom: Math.max(map.getZoom(), 15), pitch: FOLLOW_PITCH })
  }

  if (map) {
    for (const type of USER_GESTURES) map.on(type, onGesture)
    map.jumpTo({ zoom: FOLLOW_ZOOM, pitch: FOLLOW_PITCH })
    frame = requestAnimationFrame(loop)
  }

  onScopeDispose(() => {
    if (frame != null) cancelAnimationFrame(frame)
    if (map) for (const type of USER_GESTURES) map.off(type, onGesture)
  })

  return { following, resume }
}
