import { computed, markRaw, reactive, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { useStorage } from '@vueuse/core'
import type { TripOption } from '@/types/directions.types'
import { buildNavRoute, type NavRoute, type NavSegmentInput } from '@/lib/guidance/nav-route'
import type { Fix, PuckState } from '@/lib/guidance/guidance-engine'
import {
  DEFAULT_CAMERA_TUNING,
  type BearingMode,
  type CameraMode,
} from '@/lib/guidance/camera-framing'
import { hasArrived, roadLabel, summarizeProgress, type ProgressSummary } from '@/lib/guidance/guidance-display'
import { segmentAt, smoothedBearingAt } from '@/lib/guidance/nav-route'
import { cardinal, TurnAroundWatch, type Cardinal } from '@/lib/guidance/turn-around'
import { travellerHeading } from '@/lib/directions/start-motion'
import { useOrientationService } from '@/services/orientation.service'
import { adoptItinerary, rerouteOrigin, spliceReroute, splitAtStop, type AddedStop } from '@/lib/guidance/reroute'
import { switchStation, type StationSwitch } from '@/lib/guidance/dock-watch'
import { joinPlan, type JoinPlan } from '@/lib/guidance/start-eligibility'
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
import { speak, releaseSpeech, unlockSpeech, stopSpeech } from '@/services/speech/speech.service'
import { navigationSpeechRate } from '@/lib/guidance/speech-rate'
import { useSpeechStore } from '@/stores/speech.store'
import { hapticImpact } from '@/lib/haptics'
import { i18n, storedLocale } from '@/lib/i18n'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem, type LngLat } from '@/types/map.types'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { requestMotionPermission } from '@/services/guidance/position-source'
import { holdScreenAwake, releaseScreenAwake } from '@/services/guidance/wake-lock'
import { useGeolocationService } from '@/services/geolocation.service'
import { distanceMeters } from '@/lib/map/movement-interpolation'
import {
  HazardWatch,
  horizonSegment,
  horizonTarget,
  needsHorizon,
  roamProgress,
  straightSegment,
  type FreeMode,
} from '@/lib/guidance/free-roam'
import { DEFAULT_VEHICLE_PREFERENCES, vehicleChoice, type PuckMode, type VehicleChoice, type VehiclePreferences } from '@/lib/guidance/vehicle-indicator'
import type { SpeedDisplay } from '@/lib/guidance/speed-display'

// The typed `i18n.global.t` overloads exceed TS's instantiation depth here.
const translate = (i18n.global as any).t as (key: string, named?: Record<string, unknown>) => string

const PROGRESS_INTERVAL_MS = 250
const REROUTE_MIN_INTERVAL_MS = 10_000
const START_BEARING_WINDOW = 20
const HORIZON_MIN_INTERVAL_MS = 3_000
const HORIZON_RETRY_MS = 10_000
/** Below this the puck is idling and its jitter isn't distance travelled. */
const ODOMETER_MIN_SPEED = 0.5

export type GuidanceStatus = 'navigating' | 'rerouting' | 'arrived' | 'away'

/** A session follows a route to a destination, or roams free along whatever road is ahead. */
export type GuidanceKind = 'route' | 'free'

export type SoundMode = 'all' | 'alerts' | 'silent'
export const SOUND_MODES: SoundMode[] = ['all', 'alerts', 'silent']

export interface GuidancePreferences {
  cameraMode: CameraMode
  bearingMode: BearingMode
  /** Per travel mode: walkers mostly want quiet, drivers want every turn. */
  sound: Record<string, SoundMode>
  autoSwitchDocks: boolean
  vehicle: VehiclePreferences
  speedDisplay: SpeedDisplay
  adaptiveSpeech: boolean
}

export interface TurnAround {
  heading: Cardinal
  road: string | null
}

export interface GuidanceProgress extends ProgressSummary {
  puck: PuckState
  turnAround: TurnAround | null
}

type LegSegment = NavSegmentInput & TransitSegmentInput & {
  legIndex?: number
  duration?: number
  ownership?: string
  end?: { label?: string; location?: { lat: number; lng: number }; place?: { id?: string } | null }
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

/** The lane plans the route came with, by step. */
function routeLanePlans(route: NavRoute): Map<number, LanePlan> {
  return new Map(route.steps.flatMap(step => (step.lanePlan ? [[step.index, step.lanePlan] as const] : [])))
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
  /** Whether a fix has placed the traveller on or onto the route since this leg began. */
  let joined = false
  let lastJoinFixAt: number | null = null
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
  /** Lanes for each step whose approach has tagged or painted arrows; per route. */
  const lanePlans = shallowRef(new Map<number, LanePlan>())
  function setLanePlan(step: number, plan: LanePlan) {
    lanePlans.value = new Map(lanePlans.value).set(step, plan)
  }
  /** What remains of the leg after a stop added mid-route. */
  const continuation = shallowRef<LegSegment[] | null>(null)
  /** The timetable clock, to the second, for countdowns. */
  const clockMs = ref(guidanceClock.now())
  const appStore = useAppStore()
  const orientation = useOrientationService()
  let turnAroundWatch: TurnAroundWatch | null = null

  const kind = ref<GuidanceKind>('route')
  const freeMode = ref<FreeMode>('driving')
  /** The path ahead free roam follows in place of a route. */
  const horizon = shallowRef<NavRoute | null>(null)
  const roamStartedAt = ref(0)
  const travelledMeters = ref(0)
  let lastRoamPosition: { lat: number; lng: number } | null = null
  let horizonPending = false
  let nextHorizonAt = 0
  let hazardWatch: HazardWatch | null = null
  const geolocation = useGeolocationService()

  /** The line the engine follows: the route, or in free roam the path ahead. */
  const followed = computed(() => route.value ?? horizon.value)

  function modeAt(s: number): string {
    if (route.value) return travelModeAt(route.value, s)
    return kind.value === 'free' ? freeMode.value : 'driving'
  }
  const travelMode = computed(() => modeAt(progress.value?.puck.s ?? 0))

  function soundModeAt(s: number): SoundMode {
    return preferences.value.sound[modeAt(s)] ?? 'all'
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
    const speech = useSpeechStore().preferences
    const speed = progress.value?.puck.speed ?? 0
    const nextStep = route.value?.steps.find(step => step.startDistance > (announcement.kind === 'maneuver' ? announcement.step.startDistance : s) + 1)
    const deadline = announcement.kind === 'maneuver' && announcement.phase !== 'now' ? announcement.step.startDistance : nextStep?.startDistance
    const available = preferences.value.adaptiveSpeech && deadline !== undefined && speed > 0.5 ? (deadline - s) / speed : undefined
    const rate = navigationSpeechRate(text, speech.rate, available)
    speak(text, { lang: storedLocale.value, urgent, rate, voice: speech.voices[storedLocale.value], maxAgeMs: available ? Math.max(500, Math.min(8000, available * 1000)) : 8000 })
    if (urgent) void hapticImpact('medium')
  }
  const progress = shallowRef<GuidanceProgress | null>(null)
  const preferences = useStorage<GuidancePreferences>(
    'guidance-preferences',
    { cameraMode: 'follow-3d', bearingMode: 'look-ahead', sound: { driving: 'all', cycling: 'all', walking: 'alerts' }, autoSwitchDocks: true, vehicle: DEFAULT_VEHICLE_PREFERENCES, speedDisplay: 'both', adaptiveSpeech: true },
    undefined,
    { mergeDefaults: true },
  )
  watch(() => preferences.value.sound[travelMode.value], () => stopSpeech())
  // Mutable so the dev tuning panel can adjust framing live.
  const cameraTuning = reactive({ ...DEFAULT_CAMERA_TUNING })
  let progressTimer: ReturnType<typeof setInterval> | null = null

  const isActive = computed(() => route.value != null || kind.value === 'free')

  /** What the puck is drawn as for the travel mode underway. */
  const vehicle = computed<VehicleChoice>(previous => {
    const next = vehicleChoice(preferences.value.vehicle, travelMode.value)
    return previous?.indicator === next.indicator && previous.color === next.color ? previous : next
  })

  function setVehicle(mode: PuckMode, choice: Partial<VehicleChoice>) {
    const current = vehicleChoice(preferences.value.vehicle, mode)
    preferences.value.vehicle = { ...DEFAULT_VEHICLE_PREFERENCES, ...preferences.value.vehicle, [mode]: { ...current, ...choice } }
  }

  function refreshProgress() {
    if (kind.value === 'free') return refreshRoam()
    const navRoute = route.value
    const puck = guidanceEngine.sample()
    if (!navRoute || !puck || status.value === 'arrived') return
    clockMs.value = Math.floor(guidanceClock.now() / 1000) * 1000
    const summary = summarizeProgress(navRoute, puck, segmentDurations.value)
    const timetabled = timetabledRemaining(navRoute, segments.value, segmentDurations.value, puck.s, guidanceClock.now())
    if (!joined) checkJoin()
    const turnAround = puck.snapped && status.value !== 'away' ? updateTurnAround(navRoute, puck) : null
    progress.value = { puck, ...summary, remainingSeconds: timetabled ?? summary.remainingSeconds, turnAround }
    if (status.value === 'away') return
    updateTransit(navRoute, puck)
    if (puck.snapped) updateHandoff(navRoute, puck)
    const turnsMuted = transit.value != null && transit.value.kind !== 'to-stop'
    if (puck.snapped && !turnsMuted) for (const announcement of announcer?.update(puck) ?? []) announce(announcement, puck.s)
    if (puck.snapped && hasArrived(navRoute, puck)) arrive()
    else if (!puck.snapped && transit.value?.kind !== 'missed-stop') void reroute()
  }

  function updateTurnAround(navRoute: NavRoute, puck: PuckState): TurnAround | null {
    if (!turnAroundWatch) return null
    const fix = guidanceEngine.diagnostics?.lastFix
    const speed = fix?.speed ?? null
    const heading = travellerHeading({
      course: fix?.heading ?? null,
      speed,
      compass: orientation.heading.value,
      compassAccuracy: orientation.headingAccuracy.value,
    })
    const routeBearing = smoothedBearingAt(navRoute, puck.s, START_BEARING_WINDOW)
    const raised = turnAroundWatch.update({ mode: travelModeAt(navRoute, puck.s), speed, heading, routeBearing, s: puck.s })
    if (!turnAroundWatch.active) return null
    const road = roadLabel(navRoute, puck.s)
    const cue = { heading: cardinal(routeBearing), road: road.kind === 'named' ? road.name : null }
    if (raised) announce({ kind: 'turn-around', ...cue }, puck.s)
    return cue
  }

  /** Guidance waits while the traveller is too far from the route to follow it or plan onto it. */
  function checkJoin() {
    const fix = guidanceEngine.diagnostics?.lastFix
    if (!fix || fix.t === lastJoinFixAt) return
    lastJoinFixAt = fix.t
    settleJoin(joinPlan(segments.value, fix), fix)
  }

  function settleJoin(plan: JoinPlan, fix: Fix) {
    if (plan.kind === 'away') {
      status.value = 'away'
      return
    }
    joined = true
    if (status.value === 'away') status.value = 'navigating'
    if (plan.kind === 'join') void reroute({ segment: plan.segmentIndex, from: fix })
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

  /** `join` plans from a raw fix onto a segment, for a start away from the route. */
  async function reroute(join?: { segment: number; from: Fix }) {
    const navRoute = route.value
    const puck = guidanceEngine.sample()
    if (!navRoute || !puck || status.value !== 'navigating') return
    if (Date.now() - lastRerouteAt < REROUTE_MIN_INTERVAL_MS) return
    const index = join?.segment ?? segmentAt(navRoute, puck.s)?.index ?? 0
    const segment = segments.value[index]
    const destination = segment?.geometry?.at(-1)
    if (!segment || !destination || !canReroute(segment.mode)) return

    lastRerouteAt = Date.now()
    stopSpeech()
    status.value = 'rerouting'
    announce({ kind: 'reroute' }, puck.s)
    try {
      const fresh = await requestReroute({
        position: join ? join.from.position : rerouteOrigin(puck.position, puck.bearing, puck.speed),
        heading: join ? join.from.heading : puck.bearing,
        speed: join ? join.from.speed : puck.speed,
        destination,
        mode: segment.mode,
      })
      if (!fresh || route.value !== navRoute) return
      reshape(spliceReroute(segments.value, index, fresh))
      turnAroundWatch = new TurnAroundWatch()
    } catch {
      // Keep guiding on the old route; the next off-route check retries.
    } finally {
      if (status.value === 'rerouting') status.value = 'navigating'
    }
  }

  /** Swaps in a replanned leg mid-guidance, keeping the announcer's progress. */
  function reshape(next: LegSegment[]) {
    stopSpeech()
    segments.value = next
    const navRoute = markRaw(buildNavRoute(next.map(withBoardingStep)))
    lanePlans.value = routeLanePlans(navRoute)
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

  /** Rides another transit plan from segment `from` on. */
  function takeItinerary(from: number, fresh: LegSegment[]) {
    reshape(adoptItinerary(segments.value, from, fresh))
    spokenTransit = new Set()
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
      requestReroute({ position: rerouteOrigin(puck.position, puck.bearing, puck.speed), heading: puck.bearing, speed: puck.speed, destination: station.location, mode: before.mode }),
      requestReroute({ position: station.location, heading: null, destination: end, mode: after.mode }),
    ])
    if (!into || !outOf || route.value !== navRoute) return false
    reshape(switchStation(segments.value.slice(boundary), 0, into, outOf, station))
    announce({ kind: 'dock-switch', station: station.name }, puck.s)
    return true
  }

  function refreshRoam() {
    const line = horizon.value
    const puck = guidanceEngine.sample()
    clockMs.value = Math.floor(guidanceClock.now() / 1000) * 1000
    if (needsHorizon(line, puck, freeMode.value)) void extendHorizon()
    if (!line || !puck) return
    progress.value = { puck, ...roamProgress(line, puck), turnAround: null }
    if (lastRoamPosition && puck.speed > ODOMETER_MIN_SPEED) travelledMeters.value += distanceMeters(lastRoamPosition, puck.position)
    lastRoamPosition = puck.position
    const hazard = hazardWatch?.update(line, puck)
    if (hazard) announce({ kind: 'hazard', ...hazard }, puck.s)
  }

  /** Where the path ahead starts: the puck once there is one, else the latest fix. */
  function roamOrigin(): { position: LngLat; heading: number | null; speed: number | null } | null {
    const puck = guidanceEngine.sample()
    if (puck) return { position: rerouteOrigin(puck.position, puck.bearing, puck.speed), heading: puck.bearing, speed: puck.speed }
    const position = geolocation.lngLat.value
    if (!position) return null
    const speed = geolocation.coords.value.speed
    const heading = travellerHeading({
      course: geolocation.heading.value,
      speed,
      compass: orientation.heading.value,
      compassAccuracy: orientation.headingAccuracy.value,
    })
    return { position, heading, speed }
  }

  async function extendHorizon() {
    if (horizonPending || Date.now() < nextHorizonAt) return
    const from = roamOrigin()
    if (!from) return
    const mode = freeMode.value
    const heading = from.heading ?? 0
    horizonPending = true
    nextHorizonAt = Date.now() + HORIZON_MIN_INTERVAL_MS
    let segment: NavSegmentInput | null = null
    try {
      const fresh = await requestReroute({ ...from, destination: horizonTarget(from.position, heading, mode), mode })
      if (fresh) segment = horizonSegment(fresh, mode)
    } catch {
      nextHorizonAt = Date.now() + HORIZON_RETRY_MS
    } finally {
      horizonPending = false
    }
    if (kind.value !== 'free' || mode !== freeMode.value) return
    if (!segment) {
      if (horizon.value) return
      segment = straightSegment(from.position, heading, mode)
    }
    const line = markRaw(buildNavRoute([segment]))
    horizon.value = line
    if (guidanceEngine.active.value) guidanceEngine.setRoute(line)
    else guidanceEngine.start(line)
  }

  /** Drops whatever the session was following and roams free from here. */
  async function roam(mode: FreeMode) {
    unlockSpeech()
    const fresh = !isActive.value
    leaveRoute()
    kind.value = 'free'
    freeMode.value = mode
    horizon.value = null
    progress.value = null
    roamStartedAt.value = guidanceClock.now()
    travelledMeters.value = 0
    lastRoamPosition = null
    nextHorizonAt = 0
    hazardWatch = new HazardWatch()
    if (fresh) {
      await requestMotionPermission()
      holdScreenAwake()
    }
    progressTimer ??= setInterval(refreshProgress, PROGRESS_INTERVAL_MS)
    void extendHorizon()
  }

  function setFreeMode(mode: FreeMode) {
    if (kind.value !== 'free' || mode === freeMode.value) return
    freeMode.value = mode
    nextHorizonAt = 0
    void extendHorizon()
  }

  /** Turns free roam into guidance to `stop`, without leaving the view. */
  async function headTo(stop: AddedStop & { placeId?: string }): Promise<boolean> {
    const from = roamOrigin()
    const mode = freeMode.value
    if (kind.value !== 'free' || !from) return false
    const fresh = await requestReroute({ ...from, destination: stop.location, mode })
    if (!fresh || kind.value !== 'free') return false
    leaveRoam()
    const navRoute = follow([{ ...fresh, mode, end: { label: stop.label, location: stop.location, place: stop.placeId ? { id: stop.placeId } : null } }])
    if (guidanceEngine.active.value) guidanceEngine.setRoute(navRoute)
    else guidanceEngine.start(navRoute)
    return true
  }

  function leaveRoam() {
    kind.value = 'route'
    horizon.value = null
    hazardWatch = null
  }

  function leaveRoute() {
    announcer = null
    turnAroundWatch = null
    route.value = null
    trip.value = null
    segments.value = []
    continuation.value = null
    transit.value = null
    handoff.value = null
    status.value = 'navigating'
  }

  async function start(option: TripOption, leg: number) {
    unlockSpeech()
    await requestMotionPermission()
    leaveRoam()
    trip.value = markRaw(option)
    legIndex.value = leg
    continuation.value = null
    guidanceEngine.start(follow(legSegments(option, leg)))
    holdScreenAwake()
    progressTimer ??= setInterval(refreshProgress, PROGRESS_INTERVAL_MS)
  }

  /** Guides along `parts` from scratch: a new leg, or a leg reshaped by an added stop. */
  function follow(parts: LegSegment[]): NavRoute {
    const navRoute = markRaw(buildNavRoute(parts.map(withBoardingStep)))
    lanePlans.value = routeLanePlans(navRoute)
    segments.value = parts
    route.value = navRoute
    progress.value = null
    status.value = 'navigating'
    lastRerouteAt = 0
    joined = false
    lastJoinFixAt = null
    settledHandoffs = new Set()
    handoff.value = null
    slowSec = 0
    transit.value = null
    spokenTransit = new Set()
    furthestS = 0
    turnAroundWatch = new TurnAroundWatch()
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
      requestReroute({ position: rerouteOrigin(puck.position, puck.bearing, puck.speed), heading: puck.bearing, speed: puck.speed, destination: stop.location, mode: segment.mode }),
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
    releaseSpeech()
    if (progressTimer) clearInterval(progressTimer)
    progressTimer = null
    leaveRoute()
    leaveRoam()
    progress.value = null
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
    const mode = travelMode.value
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
    kind,
    freeMode,
    horizon,
    followed,
    travelMode,
    roamStartedAt,
    travelledMeters,
    roam,
    setFreeMode,
    headTo,
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
    vehicle,
    setVehicle,
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
    takeItinerary,
  }
})
