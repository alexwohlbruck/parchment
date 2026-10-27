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
import { deckLiftAt } from '@/services/guidance/deck-lift.service'
import { CAMERA_MODES, frameCamera, framingSpeed, metersPerPixel } from '@/lib/guidance/camera-framing'
import { createFramingSpeed, holdZoom, stepFramingSpeed } from '@/lib/guidance/framing-speed'
import { segmentAt } from '@/lib/guidance/nav-route'
import { trackHeldPointers } from '@/lib/map/held-pointers'
import { isUserGesture, stateAfterGesture, type CameraState } from '@/lib/guidance/camera-gesture'

const ZOOM_SMOOTH_SEC = 1.2
const PITCH_SMOOTH_SEC = 1
const LIFT_SMOOTH_SEC = 0.5
/** Below this the centre stays clamped to the ground. */
const LIFT_MIN_METERS = 0.5
const BEARING_SMOOTH_SEC = 0.5
const AUTO_RESUME_MS = 10_000
const CALM_MANEUVER_SEC = 7
const CALM_FRAME_MS = 33
const FOCAL_GAIN = 0.5
const OVERVIEW_DURATION_MS = 800
const RESTORE_DURATION_MS = 800
const USER_MOVE_START = ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const
const USER_MOVE_END = ['dragend', 'zoomend', 'rotateend', 'pitchend'] as const

type GestureEvent = MapLibreEvent & { originalEvent?: Event }

export function useGuidanceCamera() {
  const guidance = useGuidanceStore()
  const appStore = useAppStore()
  const strategy = useMapStore().getMapStrategy()
  const map = strategy?.mapInstance as MaplibreMap | undefined
  const state = ref<CameraState>('following')
  const entryView = map ? { zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() } : null
  let restored = false

  const zoom = createSpring(map?.getZoom() ?? 15)
  const pitch = createSpring(map?.getPitch() ?? 0)
  const bearing = createSpring(map?.getBearing() ?? 0)
  const lift = createSpring(0)
  let focalOffset = 0
  const speedBands = createFramingSpeed()
  let heldZoom: number | null = null
  let lastMs = performance.now()
  let resumeTimer: ReturnType<typeof setTimeout> | null = null
  const heldPointers = trackHeldPointers(() => map?.getCanvasContainer())

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
    // Each jump resets MapLibre's gesture handlers, so a held pointer pauses it or a drag could never start.
    if (heldPointers.count > 0) return 'active'
    if (!guidanceEngine.frameDue(nowMs)) return 'active'
    const route = guidanceEngine.route
    const puck = guidanceEngine.sample()
    const visible = visibleRect()
    if (!route || !puck || !visible) return 'active'

    const travelMode = segmentAt(route, puck.s)?.mode ?? 'driving'
    const target = frameCamera({
      route,
      puck,
      mode: guidance.preferences.cameraMode,
      bearingMode: guidance.preferences.bearingMode,
      travelMode,
      visibleHeight: visible.height,
      speed: stepFramingSpeed(speedBands, framingSpeed(route, puck, travelMode), nowMs / 1000),
      tuning: guidance.cameraTuning,
    })
    heldZoom = holdZoom(heldZoom, target.zoom, target.framingManeuver)

    stepSpring(zoom, heldZoom, ZOOM_SMOOTH_SEC, dt)
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
    stepSpring(lift, deckLiftAt(puck.s), LIFT_SMOOTH_SEC, dt)
    strategy?.liftCenter(lift.value > LIFT_MIN_METERS ? lift.value : 0)

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

  /** Gives the map back the zoom, tilt and heading it had before navigation, wherever it stands. */
  function restoreEntryView() {
    if (!map || !entryView || restored) return
    restored = true
    clearResumeTimer()
    state.value = 'free'
    guidanceEngine.setFrameInterval(0)
    map.easeTo({ ...entryView, duration: RESTORE_DURATION_MS })
  }

  function follow() {
    restored = false
    clearResumeTimer()
    heldZoom = null
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
    if (!isUserGesture(event)) return
    clearResumeTimer()
    state.value = stateAfterGesture(state.value)
  }
  const onUserMoveEnd = (event: GestureEvent) => {
    if (!isUserGesture(event) || state.value !== 'free') return
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
    heldPointers.dispose()
    restoreEntryView()
  })

  return {
    state,
    following: computed(() => state.value === 'following'),
    follow,
    overview,
    restoreEntryView,
    pressCameraButton,
  }
}
