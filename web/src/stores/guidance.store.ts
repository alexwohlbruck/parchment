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
import { hasArrived, summarizeProgress, type ProgressSummary } from '@/lib/guidance/guidance-display'
import { segmentAt } from '@/lib/guidance/nav-route'
import { rerouteOrigin, spliceReroute } from '@/lib/guidance/reroute'
import { canReroute, requestReroute } from '@/services/guidance/reroute.service'
import { Announcer, isAlert, type Announcement } from '@/lib/guidance/announcements'
import { announcementText } from '@/lib/guidance/phrases'
import { travelModeAt } from '@/lib/guidance/guidance-display'
import { speak, stopVoice, unlockVoice } from '@/services/guidance/voice.service'
import { hapticImpact } from '@/lib/haptics'
import { i18n, storedLocale } from '@/lib/i18n'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem } from '@/types/map.types'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { requestMotionPermission } from '@/services/guidance/position-source'
import { holdScreenAwake, releaseScreenAwake } from '@/services/guidance/wake-lock'

// The typed `i18n.global.t` overloads exceed TS's instantiation depth here.
const translate = (i18n.global as any).t as (key: string, named?: Record<string, unknown>) => string

const PROGRESS_INTERVAL_MS = 250
const REROUTE_MIN_INTERVAL_MS = 10_000

export type GuidanceStatus = 'navigating' | 'rerouting' | 'arrived'

export type SoundMode = 'all' | 'alerts' | 'silent'
export const SOUND_MODES: SoundMode[] = ['all', 'alerts', 'silent']

export interface GuidancePreferences {
  cameraMode: CameraMode
  bearingMode: BearingMode
  /** Per travel mode: walkers mostly want quiet, drivers want every turn. */
  sound: Record<string, SoundMode>
}

export interface GuidanceProgress extends ProgressSummary {
  puck: PuckState
}

type LegSegment = NavSegmentInput & {
  legIndex?: number
  duration?: number
  end?: { label?: string; location?: { lat: number; lng: number } }
}

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

/** First leg after the ones already navigated that can be followed, or null. */
export function nextNavigableLeg(trip: TripOption, after: number): number | null {
  const legs = new Set((trip.segments as LegSegment[]).map(s => s.legIndex ?? 0))
  for (const leg of [...legs].sort((a, b) => a - b)) {
    if (leg > after && isLegNavigable(trip, leg)) return leg
  }
  return null
}

export const useGuidanceStore = defineStore('guidance', () => {
  const trip = shallowRef<TripOption | null>(null)
  const tripId = computed(() => trip.value?.id ?? null)
  const legIndex = ref(0)
  const route = shallowRef<NavRoute | null>(null)
  const segments = shallowRef<LegSegment[]>([])
  const segmentDurations = computed(() => segments.value.map(s => s.duration ?? 0))
  const status = ref<GuidanceStatus>('navigating')
  /** Legs already finished, per trip, so the trip page offers the next one. */
  const completedLegs = ref<Record<string, number>>({})
  let lastRerouteAt = 0
  let announcer: Announcer | null = null
  const appStore = useAppStore()

  function soundModeAt(s: number): SoundMode {
    const mode = route.value ? travelModeAt(route.value, s) : 'driving'
    return preferences.value.sound[mode] ?? 'all'
  }

  function announce(announcement: Announcement, s: number) {
    const sound = soundModeAt(s)
    if (sound === 'silent' || (sound === 'alerts' && !isAlert(announcement))) return
    const metric = appStore.unitSystem === UnitSystem.METRIC
    const text = announcementText(announcement, metric, translate)
    const urgent = announcement.kind === 'maneuver' && announcement.phase === 'now'
    speak(text, { lang: storedLocale.value, urgent })
    if (urgent) void hapticImpact('medium')
  }
  const progress = shallowRef<GuidanceProgress | null>(null)
  const preferences = useStorage<GuidancePreferences>(
    'guidance-preferences',
    { cameraMode: 'follow-3d', bearingMode: 'look-ahead', sound: { driving: 'all', cycling: 'all', walking: 'alerts' } },
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
    if (!navRoute || !puck || status.value === 'arrived') return
    progress.value = { puck, ...summarizeProgress(navRoute, puck, segmentDurations.value) }
    if (puck.snapped) for (const announcement of announcer?.update(puck) ?? []) announce(announcement, puck.s)
    if (puck.snapped && hasArrived(navRoute, puck)) arrive()
    else if (!puck.snapped) void reroute()
  }

  function arrive() {
    status.value = 'arrived'
    if (trip.value) completedLegs.value = { ...completedLegs.value, [trip.value.id]: legIndex.value }
  }

  async function reroute() {
    const navRoute = route.value
    const puck = guidanceEngine.sample()
    if (!navRoute || !puck || status.value !== 'navigating') return
    if (Date.now() - lastRerouteAt < REROUTE_MIN_INTERVAL_MS) return
    const index = segmentAt(navRoute, puck.s)?.index ?? 0
    const segment = segments.value[index]
    const destination = segment?.geometry?.at(-1)
    if (!segment || !destination || !canReroute(segment.mode)) return

    lastRerouteAt = Date.now()
    status.value = 'rerouting'
    announce({ kind: 'reroute' }, puck.s)
    try {
      const fresh = await requestReroute({
        position: rerouteOrigin(puck.position, puck.bearing, puck.speed),
        heading: puck.bearing,
        destination,
        mode: segment.mode,
      })
      if (!fresh || route.value !== navRoute) return
      segments.value = spliceReroute(segments.value, index, fresh)
      const next = markRaw(buildNavRoute(segments.value))
      route.value = next
      guidanceEngine.setRoute(next)
      announcer?.setRoute(next)
    } catch {
      // Keep guiding on the old route; the next off-route check retries.
    } finally {
      if (status.value === 'rerouting') status.value = 'navigating'
    }
  }

  async function start(option: TripOption, leg: number) {
    unlockVoice()
    await requestMotionPermission()
    const legParts = legSegments(option, leg)
    const navRoute = markRaw(buildNavRoute(legParts))
    segments.value = legParts
    trip.value = markRaw(option)
    legIndex.value = leg
    route.value = navRoute
    progress.value = null
    status.value = 'navigating'
    lastRerouteAt = 0
    const end = legParts.at(-1)?.end?.location
    announcer = new Announcer(navRoute, end ? { lat: end.lat, lng: end.lng } : null)
    guidanceEngine.start(navRoute)
    holdScreenAwake()
    progressTimer ??= setInterval(refreshProgress, PROGRESS_INTERVAL_MS)
  }

  function stop() {
    guidanceEngine.stop()
    releaseScreenAwake()
    stopVoice()
    announcer = null
    if (progressTimer) clearInterval(progressTimer)
    progressTimer = null
    route.value = null
    progress.value = null
    trip.value = null
    segments.value = []
    status.value = 'navigating'
  }

  const destinationLabel = computed(() => segments.value.at(-1)?.end?.label ?? null)
  const nextLeg = computed(() => (trip.value ? nextNavigableLeg(trip.value, legIndex.value) : null))

  async function startNextLeg() {
    const option = trip.value
    const leg = nextLeg.value
    if (!option || leg == null) return
    stop()
    await start(option, leg)
  }

  function cycleSound() {
    const mode = route.value && progress.value ? travelModeAt(route.value, progress.value.puck.s) : 'driving'
    const current = preferences.value.sound[mode] ?? 'all'
    const next = SOUND_MODES[(SOUND_MODES.indexOf(current) + 1) % SOUND_MODES.length]
    preferences.value.sound = { ...preferences.value.sound, [mode]: next }
  }

  /** The leg the trip page's Start button begins: the first not yet navigated. */
  function legToStart(option: TripOption): number | null {
    const done = completedLegs.value[option.id]
    return nextNavigableLeg(option, done ?? -1)
  }

  return {
    trip,
    tripId,
    legIndex,
    route,
    progress,
    status,
    preferences,
    cameraTuning,
    isActive,
    destinationLabel,
    nextLeg,
    start,
    stop,
    startNextLeg,
    legToStart,
    soundModeAt,
    cycleSound,
  }
})
