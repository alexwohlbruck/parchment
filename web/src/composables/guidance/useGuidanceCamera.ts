import { computed, onScopeDispose, ref } from 'vue'
import type { Map as MaplibreMap, MapLibreEvent } from 'maplibre-gl'
import { useMapStore } from '@/stores/map.store'
import { useAppStore } from '@/stores/app.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { register as registerTick, type Tick } from '@/lib/map/animation-scheduler'
import { projectLatLng } from '@/lib/map/movement-interpolation'
import { calculateFitPadding, toContainerRect } from '@/lib/map/map-padding'
import { createSpring, stepAngleSpring, stepSpring } from '@/lib/guidance/spring'
import { CAMERA_MODES, frameCamera, metersPerPixel } from '@/lib/guidance/camera-framing'
import { segmentAt } from '@/lib/guidance/nav-route'

export type CameraState = 'following' | 'free' | 'overview'

const ZOOM_SMOOTH_SEC = 1.2
const PITCH_SMOOTH_SEC = 1
const BEARING_SMOOTH_SEC = 0.5
const AUTO_RESUME_MS = 10_000
const CALM_MANEUVER_SEC = 7
const CALM_FRAME_MS = 33
const FOCAL_GAIN = 0.5
const OVERVIEW_DURATION_MS = 800
const USER_MOVE_START = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const
const USER_MOVE_END = ['dragend', 'zoomend', 'rotateend', 'pitchend'] as const

type GestureEvent = MapLibreEvent & { originalEvent?: Event }

export function useGuidanceCamera() {
  const guidance = useGuidanceStore()
  const appStore = useAppStore()
  const map = useMapStore().getMapStrategy()?.mapInstance as MaplibreMap | undefined
  const state = ref<CameraState>('following')

  const zoom = createSpring(map?.getZoom() ?? 15)
  const pitch = createSpring(map?.getPitch() ?? 0)
  const bearing = createSpring(map?.getBearing() ?? 0)
  let focalOffset = 0
  let lastMs = performance.now()
  let resumeTimer: ReturnType<typeof setTimeout> | null = null

  function clearResumeTimer() {
    if (resumeTimer) clearTimeout(resumeTimer)
    resumeTimer = null
  }

  function visibleRect() {
    if (!map) return null
    const container = map.getContainer().getBoundingClientRect()
    return toContainerRect(appStore.visibleMapArea, container)
  }

  const tick: Tick = nowMs => {
    const dt = Math.min(0.1, Math.max(0, (nowMs - lastMs) / 1000))
    lastMs = nowMs
    if (!map || state.value !== 'following') return 'idle'
    if (!guidanceEngine.frameDue(nowMs)) return 'active'
    const route = guidanceEngine.route
    const puck = guidanceEngine.sample()
    const visible = visibleRect()
    if (!route || !puck || !visible) return 'active'

    const target = frameCamera({
      route,
      puck,
      mode: guidance.preferences.cameraMode,
      bearingMode: guidance.preferences.bearingMode,
      travelMode: segmentAt(route, puck.s)?.mode ?? 'driving',
      visibleHeight: visible.height,
      tuning: guidance.cameraTuning,
    })

    stepSpring(zoom, target.zoom, ZOOM_SMOOTH_SEC, dt)
    stepSpring(pitch, target.pitch, PITCH_SMOOTH_SEC, dt)
    stepAngleSpring(bearing, target.bearing, BEARING_SMOOTH_SEC, dt)

    const center = focalOffset > 0
      ? projectLatLng(puck.position, focalOffset, bearing.value, 1)
      : puck.position
    map.jumpTo({
      center: [center.lng, center.lat],
      zoom: zoom.value,
      pitch: pitch.value,
      bearing: bearing.value,
    })

    // Nudge the centre along the heading until the puck lands on the focal line.
    const desiredY = visible.y + target.focal * visible.height
    const error = map.project([puck.position.lng, puck.position.lat]).y - desiredY
    const groundPerPixel =
      metersPerPixel(zoom.value, puck.position.lat) / Math.max(0.35, Math.cos((pitch.value * Math.PI) / 180))
    focalOffset = Math.max(0, Math.min(3000, focalOffset - error * groundPerPixel * FOCAL_GAIN))

    const settled = Math.abs(zoom.velocity) < 0.02 && Math.abs(bearing.velocity) < 1
    guidanceEngine.setFrameInterval(settled && target.secondsToManeuver > CALM_MANEUVER_SEC ? CALM_FRAME_MS : 0)
    return 'active'
  }

  function syncSpringsToMap() {
    if (!map) return
    zoom.value = map.getZoom()
    pitch.value = map.getPitch()
    bearing.value = map.getBearing()
    zoom.velocity = pitch.velocity = bearing.velocity = 0
  }

  function follow() {
    clearResumeTimer()
    syncSpringsToMap()
    state.value = 'following'
  }

  function overview() {
    const route = guidanceEngine.route
    const puck = guidanceEngine.sample()
    const visible = visibleRect()
    if (!map || !route || !visible) return
    clearResumeTimer()
    state.value = 'overview'
    guidanceEngine.setFrameInterval(0)
    const from = puck?.s ?? 0
    const points = route.points.filter((_, i) => route.cumulative[i] >= from)
    if (puck) points.unshift(puck.position)
    if (points.length < 2) return
    const lngs = points.map(p => p.lng)
    const lats = points.map(p => p.lat)
    const container = map.getContainer()
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      {
        padding: calculateFitPadding(visible, container.clientWidth, container.clientHeight),
        bearing: 0,
        pitch: 0,
        duration: OVERVIEW_DURATION_MS,
      },
    )
  }

  /** The camera button: resumes following when free, otherwise cycles the mode. */
  function pressCameraButton() {
    if (state.value !== 'following') return follow()
    const modes = CAMERA_MODES
    const next = modes[(modes.indexOf(guidance.preferences.cameraMode) + 1) % modes.length]
    guidance.preferences.cameraMode = next
  }

  const onUserMoveStart = (event: GestureEvent) => {
    if (!event.originalEvent) return
    clearResumeTimer()
    if (state.value === 'following') state.value = 'free'
  }
  const onUserMoveEnd = (event: GestureEvent) => {
    if (!event.originalEvent || state.value !== 'free') return
    clearResumeTimer()
    resumeTimer = setTimeout(follow, AUTO_RESUME_MS)
  }

  let unregister: (() => void) | null = null
  if (map) {
    for (const type of USER_MOVE_START) map.on(type, onUserMoveStart)
    for (const type of USER_MOVE_END) map.on(type, onUserMoveEnd)
    unregister = registerTick(tick)
  }

  onScopeDispose(() => {
    unregister?.()
    clearResumeTimer()
    guidanceEngine.setFrameInterval(0)
    if (map) {
      for (const type of USER_MOVE_START) map.off(type, onUserMoveStart)
      for (const type of USER_MOVE_END) map.off(type, onUserMoveEnd)
    }
  })

  return {
    state,
    following: computed(() => state.value === 'following'),
    follow,
    overview,
    pressCameraButton,
  }
}
