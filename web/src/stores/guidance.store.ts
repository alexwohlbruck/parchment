import { nextNavigableLeg } from '@/lib/guidance/leg-navigation'
export { isLegNavigable, nextNavigableLeg } from '@/lib/guidance/leg-navigation'
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
import type { LanePlan } from '@/lib/guidance/lanes'
import { speechFor, type RichSource } from '@/lib/guidance/instructions/rich-announcement'
import { richInstruction } from '@/lib/guidance/instructions/rich-instruction'
import type { RichInstruction } from '@/lib/guidance/instructions/instruction.types'
import { countryName } from '@/lib/geo/country-codes'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { useBookmarksStore } from '@/stores/library/bookmarks.store'
import { canReroute, requestReroute, requestTransitItineraries } from '@/services/guidance/reroute.service'
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
import { estimatedPuck, RideEstimator, rideFix, type RideEstimate } from '@/lib/guidance/ride-estimator'
import { applyDepartureChange, cascadeAfter, type RebookableSegment } from '@/lib/directions/trip-rebooking'
import { retargetedRide, type VehicleCandidate } from '@/lib/guidance/vehicle-switch'
import { earliestItinerary } from '@/lib/guidance/better-itinerary'
import { getRouteTypeKey } from '@/lib/transit/transit'
import { nextRunAfter, type LineRun } from '@/services/transit/transit-departures.service'
import { guidanceClock } from '@/services/guidance/guidance-clock'
import { announcementText } from '@/lib/guidance/phrases'
import { travelModeAt } from '@/lib/guidance/guidance-display'
import { speak, releaseSpeech, unlockSpeech, stopSpeech } from '@/services/speech/speech.service'
import { navigationSpeechRate, speechDuration } from '@/lib/guidance/speech-rate'
import { useSpeechStore } from '@/stores/speech.store'
import { hapticImpact } from '@/lib/haptics'
import { i18n, storedLocale } from '@/lib/i18n'
import { useAppStore } from '@/stores/app.store'
import { UnitSystem, type LngLat } from '@/types/map.types'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { GpsCadence, PRECISE_INTERVAL_MS } from '@/lib/guidance/gps-cadence'
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
/** No fix for this long: the traveller can't be seen, as underground. */
const OUT_OF_SIGHT_MS = 30_000
/** A destination this close to the saved home is home. */
const HOME_RADIUS_METERS = 75

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
  tripId?: string
  routeType?: number
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
  /** Where on the ride the rider is reckoned to be, for when fixes can't say. */
  const rideEstimate = shallowRef<RideEstimate | null>(null)
  let ride: { segment: number; estimator: RideEstimator } | null = null
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
  const gpsCadence = new GpsCadence()

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

  const richGuidance = computed(() => useAuthService().hasPermission(PermissionId.PREMIUM_NAVIGATION))
  /** The next maneuver as rich guidance describes it, for premium travellers. */
  const nextInstruction = computed<RichInstruction | null>(() => {
    const navRoute = route.value
    const current = progress.value
    if (!richGuidance.value || !navRoute || !current?.next) return null
    const { puck, next } = current
    return richInstruction(navRoute, next, { from: puck.s, speed: puck.speed, lanes: lanePlans.value.get(next.index) })
  })
  /** Whether the leg ends at the traveller's saved home. */
  let headingHome = false

  function speechText(announcement: Announcement) {
    const metric = appStore.unitSystem === UnitSystem.METRIC
    const puck = progress.value?.puck
    const source: RichSource | null = route.value
      ? { route: route.value, from: puck?.s ?? 0, speed: puck?.speed ?? 0, lanes: lanePlans.value, home: headingHome }
      : null
    return source
      ? speechFor(announcement, source, richGuidance.value, metric, translate)
      : announcementText(announcement, metric, translate)
  }

  function announce(announcement: Announcement, s: number) {
    const sound = soundModeAt(s)
    if (sound === 'silent' || (sound === 'alerts' && !isAlert(announcement))) return
    const text = speechText(announcement)
    const urgent = (announcement.kind === 'hazard' && announcement.hazard.severity === 'high') || (announcement.kind === 'maneuver' && announcement.phase === 'now')
    const speech = useSpeechStore().preferences
    const speed = progress.value?.puck.speed ?? 0
    const nextStep = route.value?.steps.find(step => step.startDistance > (announcement.kind === 'maneuver' ? announcement.step.startDistance : s) + 1)
    const deadline = announcement.kind === 'maneuver' && announcement.phase !== 'now' ? announcement.step.startDistance : nextStep?.startDistance
    const available = preferences.value.adaptiveSpeech && deadline !== undefined && speed > 0.5 ? (deadline - s) / speed : undefined
    const rate = navigationSpeechRate(text, speech.rate, available)
    const playbackBudget = Math.min(30_000, Math.max(8000, (speechDuration(text, rate) + 3) * 1000))
    const maxAgeMs = available ? Math.max(500, Math.min(playbackBudget, available * 1000)) : playbackBudget
    speak(text, { lang: storedLocale.value, urgent, rate, voice: speech.voices[storedLocale.value], maxAgeMs })
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
    updateCadence(navRoute, puck, summary.distanceToNext)
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

  function updateCadence(navRoute: NavRoute, puck: PuckState, distanceToManeuver: number | null) {
    const stage = transit.value
    guidanceEngine.setFixInterval(gpsCadence.update({
      t: Date.now() / 1000,
      tracking: puck.snapped && status.value === 'navigating',
      mode: travelModeAt(navRoute, puck.s),
      speed: puck.speed,
      distanceToManeuver,
      ride: stage?.kind === 'riding' ? { stopsLeft: stage.stopsLeft, remaining: stage.remaining } : null,
    }))
  }

  function resetCadence() {
    gpsCadence.reset()
    guidanceEngine.setFixInterval(PRECISE_INTERVAL_MS)
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
    if (puck.snapped && !guidanceEngine.holding) furthestS = Math.max(furthestS, puck.s)
    const nowMs = guidanceClock.now()
    const progressed = { ...puck, s: Math.max(puck.s, furthestS) }
    const stage = trackRide(navRoute, transitStage(navRoute, segments.value, rides, progressed, nowMs), progressed, nowMs)
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

  /** Aboard and out of sight, the ride estimate stands in for the puck. */
  function trackRide(navRoute: NavRoute, stage: TransitStage | null, puck: PuckState, nowMs: number): TransitStage | null {
    const index = aboardSegment(navRoute, stage, puck)
    const stops = index == null ? null : rides[index]
    if (index == null || !stops?.length || !stage) {
      leaveRide()
      return stage
    }
    if (ride?.segment !== index) {
      const start = stage.kind === 'missed-vehicle' ? { s: stops[0].s, t: stage.departureMs } : { s: puck.s, t: nowMs }
      ride = { segment: index, estimator: new RideEstimator(stops, start, { realtime: !!segments.value[index].realTimeData }) }
    }
    const diagnostics = guidanceEngine.diagnostics
    const raw = diagnostics?.rawFix
    const estimate = ride.estimator.update({
      now: nowMs,
      fix: raw ? rideFix(navRoute, navRoute.segments[index], raw, nowMs - Date.now()) : null,
      still: diagnostics?.sensorStill ?? null,
    })
    rideEstimate.value = estimate
    guidanceEngine.hold(estimate.fresh ? null : estimate.shownS)
    return estimate.fresh ? stage : transitStage(navRoute, segments.value, rides, estimatedPuck(puck, estimate), nowMs)
  }

  /** The ride the traveller is on: riding, or gone with a vehicle that left while they were out of sight. */
  function aboardSegment(navRoute: NavRoute, stage: TransitStage | null, puck: PuckState): number | null {
    switch (stage?.kind) {
      case 'riding':
        return stage.segmentIndex
      case 'missed-stop':
        return segmentAt(navRoute, puck.s)?.index === stage.segmentIndex ? stage.segmentIndex : null
      case 'missed-vehicle': {
        const fix = guidanceEngine.diagnostics?.lastFix
        return !fix || Date.now() - fix.t * 1000 > OUT_OF_SIGHT_MS ? stage.segmentIndex : null
      }
      default:
        return null
    }
  }

  function leaveRide() {
    if (!ride) return
    ride = null
    rideEstimate.value = null
    guidanceEngine.hold(null)
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

  /** Rides `candidate` on segment `index` in place of the planned run, re-timing what follows. */
  async function retargetRide(index: number, candidate: VehicleCandidate, known: string[]) {
    const segment = segments.value[index]
    if (!segment || segment.tripId === candidate.tripId) return
    Object.assign(segment, retargetedRide(segment, candidate, known))
    const all = (trip.value?.segments ?? []) as unknown as (RebookableSegment & LineRun)[]
    const at = all.indexOf(segment as unknown as RebookableSegment & LineRun)
    const timed = at >= 0 ? all : (segments.value as unknown as (RebookableSegment & LineRun)[])
    const held = await cascadeAfter(timed, at >= 0 ? at : index, (i, minMs) => nextRunAfter(timed[i], minMs))
    segments.value = [...segments.value]
    if (route.value) placeRides(route.value)
    leaveRide()
    if (!held) await replanAfter(index)
  }

  /** Replans the rest of the leg from where ride `index` gets off, keeping the ride itself. */
  async function replanAfter(index: number) {
    const navRoute = route.value
    const ridden = segments.value[index]
    const from = ridden?.arrivalStop?.location ?? ridden?.geometry?.at(-1)
    const end = segments.value.at(-1)?.geometry?.at(-1)
    if (!navRoute || !ridden || !from || !end || index >= segments.value.length - 1) return
    try {
      const fresh = earliestItinerary(await requestTransitItineraries({ position: from, destination: end, departAt: new Date(ridden.endTime ?? guidanceClock.now()) }))
      if (!fresh || route.value !== navRoute) return
      reshape([...segments.value.slice(0, index + 1), ...adoptItinerary(segments.value, index + 1, fresh.segments as LegSegment[])])
    } catch {
      // The re-timed plan still stands; the itinerary check offers a better one later.
    }
  }

  /** Asks aloud which vehicle the rider boarded on segment `index`. */
  function askWhichVehicle(index: number) {
    const s = progress.value?.puck.s
    if (s == null) return
    announce({ kind: 'vehicle-question', vehicle: getRouteTypeKey(segments.value[index]?.routeType) }, s)
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
    resetCadence()
    settledHandoffs = new Set()
    handoff.value = null
    furthestS = 0
    leaveRide()
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
    stopSpeech()
    announcer = null
    turnAroundWatch = null
    route.value = null
    trip.value = null
    segments.value = []
    continuation.value = null
    transit.value = null
    leaveRide()
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
    stopSpeech()
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
    leaveRide()
    turnAroundWatch = new TurnAroundWatch()
    placeRides(navRoute)
    resetCadence()
    const end = parts.at(-1)?.end?.location
    const home = useBookmarksStore().bookmarks.find(b => b.frequentType === 'home')
    headingHome = !!end && !!home && distanceMeters(end, home) <= HOME_RADIUS_METERS
    announcer = new Announcer(navRoute, end ? { lat: end.lat, lng: end.lng } : null, (announcement, available) => {
      const text = speechText(announcement)
      const rate = navigationSpeechRate(text, useSpeechStore().preferences.rate, preferences.value.adaptiveSpeech && (progress.value?.puck.speed ?? 0) > 0.5 ? available : undefined)
      return speechDuration(text, rate)
    }, richGuidance.value ? { regionName: code => countryName(code, storedLocale.value) } : {})
    const initial = announcer.start()
    if (initial) announce(initial, 0)
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
    rideEstimate,
    rebooking,
    catchNextRun,
    retargetRide,
    askWhichVehicle,
    clockMs,
    addStop,
    switchDock,
    lanePlans,
    setLanePlan,
    richGuidance,
    nextInstruction,
    takeAlternative,
    takeItinerary,
  }
})
