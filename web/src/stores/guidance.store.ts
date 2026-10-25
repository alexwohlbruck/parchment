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
import { rerouteOrigin, spliceReroute, splitAtStop, type AddedStop } from '@/lib/guidance/reroute'
import { switchStation, type StationSwitch } from '@/lib/guidance/dock-watch'
import { laneHint, type LanePlan } from '@/lib/guidance/lanes'
import { canReroute, requestReroute } from '@/services/guidance/reroute.service'
import { Announcer, isAlert, type Announcement } from '@/lib/guidance/announcements'
import { dueHandoff, slowDuration, type Handoff } from '@/lib/guidance/handoff'
import {
  rideStops,
  stageEvent,
  withBoardingStep,
  timetabledRemaining,
  transitStage,
  type RideStop,
  type TransitSegmentInput,
  type TransitStage,
} from '@/lib/guidance/transit-progress'
import { applyDepartureChange, type RebookableSegment } from '@/lib/directions/trip-rebooking'
import { nextRunAfter, type LineRun } from '@/services/transit/transit-departures.service'
import { guidanceClock } from '@/services/guidance/guidance-clock'
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
  autoSwitchDocks: boolean
}

export interface GuidanceProgress extends ProgressSummary {
  puck: PuckState
}

type LegSegment = NavSegmentInput & TransitSegmentInput & {
  legIndex?: number
  duration?: number
  ownership?: string
  end?: { label?: string; location?: { lat: number; lng: number } }
  sharedMobilityDetails?: { stationName?: string; toStationName?: string; availableDocks?: number } | null
}

export function legSegments(trip: TripOption, legIndex: number): LegSegment[] {
  return (trip.segments as LegSegment[]).filter(
    s => (s.legIndex ?? 0) === legIndex && (s.geometry?.length ?? 0) > 1,
  )
}

/** Navigation can follow a leg once every segment in it has a shape to follow. */
export function isLegNavigable(trip: TripOption, legIndex: number): boolean {
  const leg = (trip.segments as LegSegment[]).filter(s => (s.legIndex ?? 0) === legIndex)
  return leg.length > 0 && leg.every(s => (s.geometry?.length ?? 0) > 1)
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
  const handoff = shallowRef<Handoff | null>(null)
  /** Segments whose handoff was accepted or dismissed; per route, cleared on reroute. */
  let settledHandoffs = new Set<number>()
  let slowSec = 0
  const transit = shallowRef<TransitStage | null>(null)
  let rides: (RideStop[] | null)[] = []
  /** Transit events already spoken, keyed by segment and event. */
  let spokenTransit = new Set<string>()
  /** Furthest snapped distance reached; boarding and alighting don't undo. */
  let furthestS = 0
  const rebooking = ref(false)
  /** Lanes for each step whose approach has painted arrows; per route. */
  const lanePlans = shallowRef(new Map<number, LanePlan>())
  function setLanePlan(step: number, plan: LanePlan) {
    lanePlans.value = new Map(lanePlans.value).set(step, plan)
  }
  /** What remains of the leg after a stop added mid-route. */
  const continuation = shallowRef<LegSegment[] | null>(null)
  /** The timetable clock, to the second, for countdowns. */
  const clockMs = ref(guidanceClock.now())
  const appStore = useAppStore()

  function soundModeAt(s: number): SoundMode {
    const mode = route.value ? travelModeAt(route.value, s) : 'driving'
    return preferences.value.sound[mode] ?? 'all'
  }

  function announce(announcement: Announcement, s: number) {
    const sound = soundModeAt(s)
    if (sound === 'silent' || (sound === 'alerts' && !isAlert(announcement))) return
    const metric = appStore.unitSystem === UnitSystem.METRIC
    const hint = announcement.kind === 'maneuver' && announcement.phase !== 'now' ? lanePlans.value.get(announcement.step.index) : undefined
    const lanes = hint ? laneHint(hint) : null
    const text = lanes
      ? translate('guidance.voice.useLanes', { lanes: translate(`guidance.voice.lanes.${lanes.side}${lanes.count > 1 ? 'Many' : ''}`, { n: lanes.count }), action: announcementText(announcement, metric, translate) })
      : announcementText(announcement, metric, translate)
    const urgent = announcement.kind === 'maneuver' && announcement.phase === 'now'
    speak(text, { lang: storedLocale.value, urgent })
    if (urgent) void hapticImpact('medium')
  }
  const progress = shallowRef<GuidanceProgress | null>(null)
  const preferences = useStorage<GuidancePreferences>(
    'guidance-preferences',
    { cameraMode: 'follow-3d', bearingMode: 'look-ahead', sound: { driving: 'all', cycling: 'all', walking: 'alerts' }, autoSwitchDocks: true },
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
    clockMs.value = Math.floor(guidanceClock.now() / 1000) * 1000
    const summary = summarizeProgress(navRoute, puck, segmentDurations.value)
    const timetabled = timetabledRemaining(navRoute, segments.value, segmentDurations.value, puck.s, guidanceClock.now())
    progress.value = { puck, ...summary, remainingSeconds: timetabled ?? summary.remainingSeconds }
    updateTransit(navRoute, puck)
    if (puck.snapped) updateHandoff(navRoute, puck)
    const turnsMuted = transit.value != null && transit.value.kind !== 'to-stop'
    if (puck.snapped && !turnsMuted) for (const announcement of announcer?.update(puck) ?? []) announce(announcement, puck.s)
    if (puck.snapped && hasArrived(navRoute, puck)) arrive()
    else if (!puck.snapped && transit.value?.kind !== 'missed-stop') void reroute()
  }

  function updateHandoff(navRoute: NavRoute, puck: PuckState) {
    slowSec = slowDuration(slowSec, puck.speed, PROGRESS_INTERVAL_MS / 1000)
    const due = dueHandoff(navRoute, puck, segments.value, slowSec)
    const shown = handoff.value
    if (shown && (!due || due.from !== shown.from)) {
      // Moving on into the next segment answers the card.
      settledHandoffs.add(shown.from)
      handoff.value = null
    }
    if (due && !handoff.value && !settledHandoffs.has(due.from)) {
      handoff.value = due
      announce({ kind: 'handoff', handoff: due }, puck.s)
    }
  }

  function updateTransit(navRoute: NavRoute, puck: PuckState) {
    if (puck.snapped) furthestS = Math.max(furthestS, puck.s)
    const stage = transitStage(navRoute, segments.value, rides, { ...puck, s: Math.max(puck.s, furthestS) }, guidanceClock.now())
    transit.value = stage
    const event = stage && stageEvent(stage)
    if (!stage || !event) return
    const key = `${stage.segmentIndex}:${event}`
    if (spokenTransit.has(key)) return
    spokenTransit.add(key)
    const segment = segments.value[stage.segmentIndex]
    const stop = stage.kind === 'riding' || stage.kind === 'missed-stop' ? stage.alight : stage.stop
    announce({ kind: 'transit', event, line: segment?.lineName ?? '', headsign: segment?.headsign, stop }, puck.s)
    if (event === 'alight-now' || event.startsWith('missed')) void hapticImpact('heavy')
  }

  function placeRides(navRoute: NavRoute) {
    rides = segments.value.map((segment, i) => (segment.mode === 'transit' ? rideStops(navRoute, i, segment) : null))
  }

  /** Moves a missed boarding onto the line's next run, re-timing the rest of the trip. */
  async function catchNextRun(): Promise<boolean> {
    const stage = transit.value
    const option = trip.value
    if (!option || stage?.kind !== 'missed-vehicle' || rebooking.value) return false
    const all = option.segments as unknown as (RebookableSegment & LineRun)[]
    const index = all.indexOf(segments.value[stage.segmentIndex] as unknown as RebookableSegment & LineRun)
    if (index < 0) return false
    rebooking.value = true
    try {
      const next = await nextRunAfter(all[index], Math.max(stage.departureMs + 60_000, guidanceClock.now()))
      if (next == null) return false
      await applyDepartureChange(all, index, next, (i, minMs) => nextRunAfter(all[i], minMs))
      segments.value = [...segments.value]
      if (route.value) placeRides(route.value)
      spokenTransit = new Set([...spokenTransit].filter(key => !key.startsWith(`${stage.segmentIndex}:`)))
      return true
    } finally {
      rebooking.value = false
    }
  }

  function settleHandoff() {
    if (handoff.value) settledHandoffs.add(handoff.value.from)
    handoff.value = null
  }

  function arrive() {
    status.value = 'arrived'
    if (trip.value && !continuation.value) completedLegs.value = { ...completedLegs.value, [trip.value.id]: legIndex.value }
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
      reshape(spliceReroute(segments.value, index, fresh))
    } catch {
      // Keep guiding on the old route; the next off-route check retries.
    } finally {
      if (status.value === 'rerouting') status.value = 'navigating'
    }
  }

  /** Swaps in a replanned leg mid-guidance, keeping the announcer's progress. */
  function reshape(next: LegSegment[]) {
    segments.value = next
    lanePlans.value = new Map()
    const navRoute = markRaw(buildNavRoute(next.map(withBoardingStep)))
    route.value = navRoute
    guidanceEngine.setRoute(navRoute)
    announcer?.setRoute(navRoute)
    settledHandoffs = new Set()
    handoff.value = null
    furthestS = 0
    placeRides(navRoute)
  }

  /** Follows another route for the rest of the segment the traveller is on. */
  function takeAlternative(index: number, alternative: Partial<LegSegment>) {
    reshape(spliceReroute(segments.value, index, alternative))
  }

  /** Heads for a different bike share station; the segments either side of it are replanned. */
  async function switchDock(boundary: number, station: StationSwitch): Promise<boolean> {
    const navRoute = route.value
    const puck = guidanceEngine.sample()
    const before = segments.value[boundary]
    const after = segments.value[boundary + 1]
    const end = after?.geometry?.at(-1)
    if (!navRoute || !puck || !before || !after || !end) return false
    const [into, outOf] = await Promise.all([
      requestReroute({ position: rerouteOrigin(puck.position, puck.bearing, puck.speed), heading: puck.bearing, destination: station.location, mode: before.mode }),
      requestReroute({ position: station.location, heading: null, destination: end, mode: after.mode }),
    ])
    if (!into || !outOf || route.value !== navRoute) return false
    reshape(switchStation(segments.value.slice(boundary), 0, into, outOf, station))
    announce({ kind: 'dock-switch', station: station.name }, puck.s)
    return true
  }

  async function start(option: TripOption, leg: number) {
    unlockVoice()
    await requestMotionPermission()
    trip.value = markRaw(option)
    legIndex.value = leg
    continuation.value = null
    guidanceEngine.start(follow(legSegments(option, leg)))
    holdScreenAwake()
    progressTimer ??= setInterval(refreshProgress, PROGRESS_INTERVAL_MS)
  }

  /** Guides along `parts` from scratch: a new leg, or a leg reshaped by an added stop. */
  function follow(parts: LegSegment[]): NavRoute {
    lanePlans.value = new Map()
    const navRoute = markRaw(buildNavRoute(parts.map(withBoardingStep)))
    segments.value = parts
    route.value = navRoute
    progress.value = null
    status.value = 'navigating'
    lastRerouteAt = 0
    settledHandoffs = new Set()
    handoff.value = null
    slowSec = 0
    transit.value = null
    spokenTransit = new Set()
    furthestS = 0
    placeRides(navRoute)
    const end = parts.at(-1)?.end?.location
    announcer = new Announcer(navRoute, end ? { lat: end.lat, lng: end.lng } : null)
    return navRoute
  }

  /** Heads to `stop` first; the rest of the leg becomes the next leg. */
  async function addStop(stop: AddedStop): Promise<boolean> {
    const navRoute = route.value
    const puck = guidanceEngine.sample()
    if (!navRoute || !puck) return false
    const index = segmentAt(navRoute, puck.s)?.index ?? 0
    const segment = segments.value[index]
    const end = segment?.geometry?.at(-1)
    if (!segment || !end || !canReroute(segment.mode)) return false
    const [toStop, fromStop] = await Promise.all([
      requestReroute({ position: rerouteOrigin(puck.position, puck.bearing, puck.speed), heading: puck.bearing, destination: stop.location, mode: segment.mode }),
      requestReroute({ position: stop.location, heading: null, destination: end, mode: segment.mode }),
    ])
    if (!toStop || !fromStop || route.value !== navRoute) return false
    const split = splitAtStop(segments.value, index, toStop, fromStop, stop)
    if (!split) return false
    continuation.value = [...split.continuation, ...(continuation.value ?? [])]
    guidanceEngine.setRoute(follow(split.leg))
    return true
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
    continuation.value = null
    transit.value = null
    status.value = 'navigating'
  }

  const destinationLabel = computed(() => segments.value.at(-1)?.end?.label ?? null)
  const nextLeg = computed(() =>
    continuation.value ? legIndex.value : trip.value ? nextNavigableLeg(trip.value, legIndex.value) : null,
  )

  async function startNextLeg() {
    const rest = continuation.value
    if (rest) {
      continuation.value = null
      guidanceEngine.setRoute(follow(rest))
      return
    }
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
    handoff,
    settleHandoff,
    segments,
    transit,
    rebooking,
    catchNextRun,
    clockMs,
    addStop,
    switchDock,
    lanePlans,
    setLanePlan,
    takeAlternative,
  }
})
