import { computed, markRaw, reactive, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import type { TripOption } from '@/types/directions.types'
import { buildNavRoute, type NavRoute, type NavSegmentInput } from '@/lib/guidance/nav-route'
import type { PuckState } from '@/lib/guidance/guidance-engine'
import {
  DEFAULT_CAMERA_TUNING,
  type BearingMode,
  type CameraMode,
} from '@/lib/guidance/camera-framing'
import { summarizeProgress, type ProgressSummary } from '@/lib/guidance/guidance-display'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { requestMotionPermission } from '@/services/guidance/position-source'
import { holdScreenAwake, releaseScreenAwake } from '@/services/guidance/wake-lock'

const PROGRESS_INTERVAL_MS = 250

export interface GuidancePreferences {
  cameraMode: CameraMode
  bearingMode: BearingMode
}

export interface GuidanceProgress extends ProgressSummary {
  puck: PuckState
}

type LegSegment = NavSegmentInput & { legIndex?: number; duration?: number }

export function legSegments(trip: TripOption, legIndex: number): LegSegment[] {
  return (trip.segments as LegSegment[]).filter(
    s => (s.legIndex ?? 0) === legIndex && (s.geometry?.length ?? 0) > 1,
  )
}

/** Navigation can follow a leg once every segment in it has a street route. */
export function isLegNavigable(trip: TripOption, legIndex: number): boolean {
  const segments = legSegments(trip, legIndex)
  return segments.length > 0 && segments.every(s => s.mode !== 'transit')
}

export const useGuidanceStore = defineStore('guidance', () => {
  const tripId = ref<string | null>(null)
  const legIndex = ref(0)
  const route = shallowRef<NavRoute | null>(null)
  const segmentDurations = shallowRef<number[]>([])
  const progress = shallowRef<GuidanceProgress | null>(null)
  const preferences = useStorage<GuidancePreferences>(
    'guidance-preferences',
    { cameraMode: 'follow-3d', bearingMode: 'look-ahead' },
    undefined,
    { mergeDefaults: true },
  )
  // Mutable so the dev tuning panel can adjust framing live.
  const cameraTuning = reactive({ ...DEFAULT_CAMERA_TUNING })
  let progressTimer: ReturnType<typeof setInterval> | null = null

  const isActive = computed(() => route.value != null)

  function refreshProgress() {
    const navRoute = route.value
    const puck = guidanceEngine.sample()
    if (!navRoute || !puck) return
    progress.value = { puck, ...summarizeProgress(navRoute, puck, segmentDurations.value) }
  }

  async function start(trip: TripOption, leg: number) {
    await requestMotionPermission()
    const segments = legSegments(trip, leg)
    const navRoute = markRaw(buildNavRoute(segments))
    segmentDurations.value = segments.map(s => s.duration ?? 0)
    tripId.value = trip.id
    legIndex.value = leg
    route.value = navRoute
    progress.value = null
    guidanceEngine.start(navRoute)
    holdScreenAwake()
    progressTimer ??= setInterval(refreshProgress, PROGRESS_INTERVAL_MS)
  }

  function stop() {
    guidanceEngine.stop()
    releaseScreenAwake()
    if (progressTimer) clearInterval(progressTimer)
    progressTimer = null
    route.value = null
    progress.value = null
    tripId.value = null
  }

  return { tripId, legIndex, route, progress, preferences, cameraTuning, isActive, start, stop }
})
