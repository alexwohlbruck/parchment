<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  depCountdown,
  formatClockCompact,
  formatCurrency,
  joinStatus,
  movingDuration,
} from '@/lib/directions/trip-display'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { api } from '@/lib/api'
import { applyDepartureChange } from '@/lib/directions/trip-rebooking'
import { sameArrivalDepartAt, tightChanges, walksToFirstStop } from '@/lib/directions/trip-advice'
import { nextRunAfter } from '@/services/transit/transit-departures.service'
import { useDirectionsStore } from '@/stores/directions.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { useTripFocusStore } from '@/stores/trip-focus.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useRoutePreviewStore } from '@/stores/route-preview.store'
import { useStartEligibility } from '@/composables/guidance/useStartEligibility'
import { useTripAdvice } from '@/composables/directions/useTripAdvice'
import { useTransitClock } from '@/composables/transit/useTransitClock'
import { useDirectionsService } from '@/services/directions.service'
import { useMapService } from '@/services/map/map.service'
import { useGeolocationService } from '@/services/geolocation.service'
import {
  departureReachability,
  remainingAccessWalkSec,
  seemsAboard,
  type DepartureReachability,
} from '@/lib/transit/transit-reachability'
import { Button } from '@/components/ui/button'
import { Caption } from '@/components/ui/typography'
import { Skeleton } from '@/components/ui/skeleton'
import {
  BookmarkIcon,
  ClockIcon,
  NavigationIcon,
  MapIcon,
  RefreshCwIcon,
  ShareIcon,
  TriangleAlertIcon,
} from 'lucide-vue-next'
import { AppRoute } from '@/router'
import { tripSignature } from '@/lib/directions/trip-signature'
import type { RouteInstruction } from '@/types/directions.types'
import type { RouteProfileType } from '@/lib/directions/route-profile-colors'
import AdviceStatusLine from '@/components/directions/AdviceStatusLine.vue'
import TripTimeline from '@/components/directions/trip/TripTimeline.vue'
import TripStrip from '@/components/directions/trip/TripStrip.vue'
import TripColorPicker from '@/components/directions/trip/TripColorPicker.vue'
import TripColorLegend from '@/components/directions/trip/TripColorLegend.vue'
import { canColorBy, tripProfiles } from '@/lib/directions/trip-strip'
import { useRouteWaypoints } from '@/composables/directions/useRouteWaypoints'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { useTransitAlertsStore } from '@/stores/transit-alerts.store'
import { splitFeedId, isInEffect, sortByRelevance } from '@/lib/transit/transit-alerts'
import type { ServiceAlert } from '@/types/transit.types'
import PanelLayout from '@/components/sheet/layouts/PanelLayout.vue'
import { SheetHeader } from '@/components/sheet'
import { useUnits } from '@/composables/useUnits'
import { useI18n } from 'vue-i18n'

const route = useRoute()
const router = useRouter()
const directionsStore = useDirectionsStore()
const navigationPreferences = useNavigationPreferencesStore()
const tripFocusStore = useTripFocusStore()
const directionsService = useDirectionsService()
const mapService = useMapService()
const { t: translate } = useI18n()
// Live position, so the approach walk on the departure board decays as the
// rider actually closes on the stop.
const geo = useGeolocationService()
const { formatDistance } = useUnits()

// ── Upcoming departures per transit segment ─────────────────────────
// Shows the rider their options beyond the planned departure ("also at
// 2:21, 2:51"), Transit-app style. Fetched per boarding stop, filtered to
// the same line and direction. Clicking a later one re-plans the trip
// anchored to that departure.
interface DepartureOption {
  ms: number
  label: string
  /** True when the time comes from a GTFS-RT prediction, not the schedule. */
  realTime: boolean
  /** Signed seconds against the timetable (+late, -early); realtime runs only. */
  delaySec?: number
  /** Timetabled departure, shown struck beside the live time when they differ. */
  scheduledMs?: number
  /** The operator has pulled this run. Kept on the board as an explanation
   *  rather than silently vanishing. */
  cancelled?: boolean
  /** Which route this departure is — shown on merged "4 or 5" boards so the
   *  rider knows whether each run is the 4 or the 5. */
  route?: { shortName?: string; color?: string; textColor?: string }
  /** The run's GTFS trip, so a trip-scoped service alert can find its chip. */
  tripId?: string
}
const segmentDepartures = ref<Record<number, DepartureOption[]>>({})
// Full fetched schedule per segment (superset of the chips) — rebooking
// resolves runs from this synchronously, so switching departures is instant.
const segmentSchedule = ref<Record<number, DepartureOption[]>>({})

// How far back to fetch + keep already-departed runs, so the board carries
// recent past departures (shown struck) as context and they survive a rebook.
const DEPARTURE_PAST_WINDOW_MS = 30 * 60_000
// On first entry we default the selection to the soonest catchable run; this
// guards that to once per trip (refreshes/rebooks must not re-trigger it).
const didAutoSelectDeparture = ref(false)

// Clock driving the departed/hurry chip states (and the decaying approach
// walk behind them); departures re-fetch keeps the
// realtime predictions fresh as vehicles move.
const clock = useTransitClock(10_000)
const nowMs = computed(() => clock.value.getTime())
const refreshTimer = setInterval(() => { void loadDepartures() }, 30_000)
onUnmounted(() => clearInterval(refreshTimer))

// ── Service alerts per transit leg ──────────────────────────────────
// What the agency has published about the line you're about to ride, on the
// leg it affects. MOTIS hands us feed-prefixed ids ("mta-nyct_B48"); alerts
// are keyed by the feed-local half, so every id is split before it's asked
// about.
const alertsStore = useTransitAlertsStore()
const segmentAlerts = ref<Record<number, ServiceAlert[]>>({})

/** What this leg is, in the terms an alert feed is keyed by. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function alertQueryForSegment(seg: any): {
  feedId: string
  routeIds: string[]
  stopIds: string[]
  tripIds: string[]
} | null {
  const td = seg.transitDetails
  const routeId: string | undefined = td?.route?.id
  if (!routeId) return null

  const { feedId, localId } = splitFeedId(routeId)
  if (!feedId) return null

  const local = (id?: string) => (id ? splitFeedId(id).localId : null)

  // Interchangeable lines (the 4 and the 5) are one leg to the rider, so an
  // alert on either of them belongs on this card.
  const routeIds = [
    localId,
    ...((td?.routeOptions ?? []) as Array<{ id?: string }>)
      .map((r) => local(r.id))
      .filter(Boolean) as string[],
  ]

  const stopIds = [td?.departureStop?.id, td?.arrivalStop?.id]
    .map((id) => local(id))
    .filter(Boolean) as string[]

  const tripIds = [local(td?.trip?.id)].filter(Boolean) as string[]

  return {
    feedId,
    routeIds: [...new Set(routeIds)],
    stopIds: [...new Set(stopIds)],
    tripIds,
  }
}

async function loadAlerts() {
  const t = trip.value
  if (!t) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]
  const next: Record<number, ServiceAlert[]> = {}

  await Promise.all(
    segs.map(async (seg, idx) => {
      if (seg.mode !== 'transit') return
      const query = alertQueryForSegment(seg)
      if (!query) return
      // Each run on the board carries its own trip; a trip-scoped alert only
      // reaches a chip if we asked about that trip.
      const boardTripIds = (segmentDepartures.value[idx] ?? [])
        .map((d) => (d.tripId ? splitFeedId(d.tripId).localId : null))
        .filter(Boolean) as string[]

      const alerts = await alertsStore.fetchAlerts({
        ...query,
        tripIds: [...new Set([...query.tripIds, ...boardTripIds])],
      })
      if (alerts.length) next[idx] = alerts
    }),
  )

  segmentAlerts.value = next
}

/** The one leg alert whose full text is open, at most. */
const openLegAlertId = ref<string | null>(null)

function toggleLegAlert(alert: ServiceAlert) {
  openLegAlertId.value = openLegAlertId.value === alert.id ? null : alert.id
}

/**
 * Alerts about the leg itself — the line or the stops, not one specific run.
 * Those are the ones worth showing on the trip; per-run ones badge their chip.
 *
 * Only what is in effect for the ride: a line's scheduled overnight work is a
 * wall of cards on a trip you are taking this afternoon, and the rider cannot
 * act on it. The route page is where the full list lives.
 */
function legAlerts(segmentIndex: number): ServiceAlert[] {
  const alerts = segmentAlerts.value[segmentIndex] ?? []
  return sortByRelevance(
    alerts.filter((a) => a.informedEntities.some((e) => !e.tripId) && isInEffect(a)),
  )
}

async function loadDepartures() {
  const t = trip.value
  if (!t) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]
  const nextChips: Record<number, DepartureOption[]> = {}
  const nextSched: Record<number, DepartureOption[]> = {}
  await Promise.all(
    segs.map(async (seg, idx) => {
      if (seg.mode !== 'transit' || !seg.departureStop?.location) return
      try {
        const startMs = new Date(seg.startTime).getTime()

        // Earliest run the rider could physically board: mid-trip you can
        // only board out of the existing platform wait (arrival on foot);
        // for the first boarding, leaving home earlier is bounded by the
        // requested departure time (or now).
        const hasEarlierTransit = segs
          .slice(0, idx)
          .some((s) => s.mode === 'transit')
        let floorMs: number
        if (hasEarlierTransit) {
          const prev = segs[idx - 1]
          floorMs = prev?.mode === 'walking'
            ? new Date(prev.endTime).getTime() - (prev.waitSeconds ?? 0) * 1000
            : startMs
        } else {
          const requestedMs = directionsStore.departureTime
            ? new Date(directionsStore.departureTime).getTime()
            : Date.now()
          floorMs = requestedMs + (startMs - new Date(t.startTime).getTime())
        }

        // Fetch from a fixed past window (anchored on now, not the selected
        // run) so recent departures are always included and don't drop out when
        // the rider picks a later train.
        const fetchFromMs =
          Math.min(floorMs, startMs, nowMs.value) - DEPARTURE_PAST_WINDOW_MS
        const { data } = await api.get('/transit/departures', {
          params: {
            lat: seg.departureStop.location.lat,
            lng: seg.departureStop.location.lng,
            radius: 50,
            n: 60,
            time: new Date(fetchFromMs).toISOString(),
          },
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const all: any[] = (Array.isArray(data) ? data : []).flatMap(
          (s: { departures?: unknown[] }) => s.departures ?? [],
        )
        // Merged "4 or 5" legs match any of their interchangeable routes.
        const routeNames: (string | undefined)[] = seg.routeOptions?.length
          ? seg.routeOptions.map((o: { shortName?: string }) => o.shortName)
          : [seg.lineName]
        // Cancelled runs stay in the pool — a train vanishing off the board
        // with no explanation is worse than one struck through as cancelled.
        const sameLine = all.filter((d) => routeNames.includes(d.route?.shortName))
        // Same direction: by GTFS direction_id when present (reliable across
        // the 4 and 5, which carry different headsigns), else by headsign.
        let pool: typeof sameLine
        if (seg.directionId != null) {
          const sameDir = sameLine.filter(
            (d) => String(d.directionId) === String(seg.directionId),
          )
          pool = sameDir.length ? sameDir : sameLine
        } else {
          const sameDir = sameLine.filter(
            (d) => d.headsign?.toLowerCase() === seg.headsign?.toLowerCase(),
          )
          pool = sameDir.length >= 2 ? sameDir : sameLine
        }
        // Dedup by minute; a run is "live" when any source row carries a
        // GTFS-RT prediction for it. Keep the route so a merged board can show
        // which train each run is.
        const byMs = new Map<
          number,
          {
            realTime: boolean
            delaySec?: number
            scheduledMs?: number
            cancelled: boolean
            route?: DepartureOption['route']
            tripId?: string
          }
        >()
        for (const d of pool) {
          const depMs = new Date(d.departureTime).getTime()
          // Keep already-departed runs (down to the past window) — they show as
          // departed and give the rider useful "just missed it" context.
          if (depMs < fetchFromMs) continue
          const prev = byMs.get(depMs)
          const schedMs = d.scheduledDepartureTime
            ? new Date(d.scheduledDepartureTime).getTime()
            : undefined
          byMs.set(depMs, {
            realTime: (prev?.realTime ?? false) || d.realTime === true,
            delaySec: prev?.delaySec ?? (typeof d.delay === 'number' ? d.delay : undefined),
            scheduledMs: prev?.scheduledMs ?? schedMs,
            // A run only counts as cancelled when no source still runs it.
            cancelled: (prev?.cancelled ?? true) && d.cancelled === true,
            route: prev?.route ?? (d.route ? runRoute(seg, d.route.shortName) : undefined),
            tripId: prev?.tripId ?? d.trip?.id,
          })
        }
        const runs: DepartureOption[] = [...byMs.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([ms, info]) => ({
            ms,
            realTime: info.realTime,
            delaySec: info.delaySec,
            scheduledMs: info.scheduledMs,
            cancelled: info.cancelled,
            route: info.route,
            tripId: info.tripId,
            label: formatTime(new Date(ms)),
          }))
        nextSched[idx] = runs
        // Window on NOW (not the selected run): a tail of recently-departed
        // runs (struck context) stays put when the rider picks a later train,
        // plus the next ~hour of upcoming service — always extended through the
        // planned run so the selection is never sliced out of view.
        const cutoff = nowMs.value - 30_000
        const upcoming = runs.filter((d) => d.ms >= cutoff)
        const selIdx = upcoming.findIndex((d) => Math.abs(d.ms - startMs) < 30_000)
        const earlier = runs.filter((d) => d.ms < cutoff).slice(-8)
        const current = upcoming.slice(0, Math.max(12, selIdx + 2))
        nextChips[idx] = [...earlier, ...current]
      } catch {
        // Departures are an enhancement — skip on failure
      }
    }),
  )
  // Atomic swap — no flicker on the periodic refresh
  segmentDepartures.value = nextChips
  segmentSchedule.value = nextSched

  // Alerts ride on the departures they annotate: a run-scoped alert can only
  // find its chip once we know which trips are on the board. The store's TTL
  // keeps the 30s refresh from re-asking the feed every time.
  void loadAlerts()

  // On first entry, default the selection to the SOONEST catchable departure of
  // the first transit leg (which may be a tight "hurry" connection) — the
  // planner often defaults to a later run.
  if (!didAutoSelectDeparture.value) {
    didAutoSelectDeparture.value = true
    selectFirstAvailableDeparture()
  }
}

function firstCatchableDeparture(segmentIndex: number): DepartureOption | undefined {
  return departuresFor(segmentIndex).find((d) => {
    if (d.cancelled) return false
    const state = depState(segmentIndex, d)
    return state === 'ok' || state === 'hurry' || state === 'run'
  })
}

/** Default the first transit leg to its earliest catchable run — including a
 *  "hurry" one, so the rider lands on the soonest train they can still make.
 *  Runs once per trip; a no-op when that's already the planned run. (This is
 *  only the default: the rider can still pick any run on the board.) */
function selectFirstAvailableDeparture() {
  const t = trip.value
  if (!t) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]
  const idx = boardingIndex(segs)
  if (idx < 0) return
  const best = bestDeparture(idx)
  if (best && !isCurrentDeparture(segs[idx], best.ms)) {
    void chooseDeparture(idx, best.ms)
  }
}

/** The first catchable run, moved on to the latest one that arrives with it, so the trip boards the train its advice is about. */
function bestDeparture(segmentIndex: number): DepartureOption | undefined {
  const first = firstCatchableDeparture(segmentIndex)
  const targetMs = first && sameArrivalDepartAt(trip.value?.departureProfile, first.ms)
  if (!first || targetMs == null) return first
  return departuresFor(segmentIndex).find(d => !d.cancelled && Math.abs(d.ms - targetMs) < 60_000) ?? first
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boardingIndex = (segs: any[]) => segs.findIndex((s) => s.mode === 'transit' && s.departureStop?.location)

/** The run the rider picked off the board; only its departure moves them off it. */
const pickedRunMs = ref<number | null>(null)

/** Why the trip is no longer on the run it was planned on, after moving it for the rider. */
const switchedNote = ref<string | null>(null)

function pickDeparture(segmentIndex: number, ms: number) {
  pickedRunMs.value = ms
  switchedNote.value = null
  void chooseDeparture(segmentIndex, ms)
}

/** Once the run the trip boards is missed, move it onto the next one still catchable. */
watch([nowMs, segmentDepartures], async () => {
  const t = trip.value
  if (!t || !didAutoSelectDeparture.value || rebooking.value) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]
  const idx = boardingIndex(segs)
  if (idx < 0) return
  const current = departuresFor(idx).find((d) => isCurrentDeparture(segs[idx], d.ms))
  if (!current) return
  const state = advice.value ? advice.value.reach : depState(idx, current)
  const start = directionsStore.trips?.request.waypoints[0]?.coordinate
  const missed =
    state === 'departed'
      ? !seemsAboard(geo.lngLat.value, segs[idx].departureStop.location, start)
      : state === 'unreachable' && current.ms !== pickedRunMs.value
  if (!missed) return
  const next = bestDeparture(idx)
  if (!next || !(await chooseDeparture(idx, next.ms))) return
  switchedNote.value = translate(`directions.advice.switched.${state === 'departed' ? 'missed' : 'tooFar'}`, {
    line: next.route?.shortName ?? segs[idx].lineName ?? '',
    time: formatClockCompact(new Date(next.ms)),
    from: formatClockCompact(new Date(current.ms)),
  })
})

/** Is this run the one the trip currently boards? */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isCurrentDeparture(segment: any, ms: number): boolean {
  return Math.abs(ms - asMs(segment.startTime)) < 30_000
}

function departuresFor(segmentIndex: number): DepartureOption[] {
  return segmentDepartures.value[segmentIndex] ?? []
}


// ── Departure rebooking ──────────────────────────────────────────────
// Choosing a later run is pure schedule math on the existing plan — no
// re-planning. The chosen leg moves to the chosen run; legs before it
// either shift later (first boarding: leave home later) or keep their
// schedule with the extra wait absorbed at the platform; legs after keep
// their planned runs when the connection still holds, otherwise roll to
// the next departure of the same line.
const rebooking = ref(false)

function asMs(v: string | Date): number {
  return new Date(v).getTime()
}

/** Next run of this segment's line departing at/after minMs. Resolves from
 *  the prefetched schedule (instant); only goes to the API when the needed
 *  run falls outside the cached window. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nextDepartureAfter(seg: any, segmentIndex: number, minMs: number): Promise<number | null> {
  const sched = segmentSchedule.value[segmentIndex] ?? []
  // The cache yields the earliest run >= minMs only when it actually begins
  // at/before minMs. After a forward rebook the cache was refetched around the
  // bumped (later) time, so rolling back to an earlier connection needs runs
  // ahead of the cached window — fall through to the API in that case.
  if (sched.length > 0 && sched[0].ms <= minMs) {
    // Never auto-roll a downstream connection onto a cancelled run — the rider
    // may knowingly pick one on the board, but we won't choose it for them.
    const cached = sched.find((d) => d.ms >= minMs && !d.cancelled)
    if (cached) return cached.ms
  }
  return nextRunAfter(seg, minMs)
}

async function chooseDeparture(segmentIndex: number, departureMs: number): Promise<boolean> {
  const t = trip.value
  if (!t || rebooking.value) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]

  rebooking.value = true
  try {
    const changed = await applyDepartureChange(
      segs,
      segmentIndex,
      departureMs,
      (i, minMs) => nextDepartureAfter(segs[i], i, minMs),
    )
    if (!changed) return false

    // Trip-level rollup
    t.startTime = new Date(asMs(segs[0].startTime))
    t.endTime = new Date(asMs(segs[segs.length - 1].endTime))
    t.summary.totalDuration = (asMs(t.endTime) - asMs(t.startTime)) / 1000

    // Refresh chips in the background — the rebooking math is already
    // applied from the cached schedule, so the UI updates instantly.
    void loadDepartures()
    return true
  } finally {
    rebooking.value = false
  }
}

// ── Departure chip states (Transit-app style) ────────────────────────
// departed: the vehicle is gone. unreachable: still upcoming, but not on
// foot from where the rider is. hurry: catchable, but only just — the walk
// leaves under 3 minutes of slack. live: time comes from GTFS-RT.
// All of these are hints; none of them block a rebook.

/** Approach walk still ahead of the rider for this boarding, when it's the
 *  trip's first transit leg (0 otherwise — mid-trip positions depend on
 *  earlier legs, so only "departed" can be judged there). Decays as the rider
 *  actually closes on the stop rather than staying pinned to the plan. */
function remainingWalkSec(segmentIndex: number): number {
  const t = trip.value
  if (!t) return 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]
  const isFirst = !segs.slice(0, segmentIndex).some((s) => s.mode === 'transit')
  if (!isFirst) return 0
  const prev = segs[segmentIndex - 1]
  if (!prev || prev.mode === 'transit') return 0
  const planned = movingDuration(prev)
  // Arrival at the stop excludes the platform wait folded into the walk leg.
  const arrivalMs = asMs(prev.endTime) - (prev.waitSeconds ?? 0) * 1000
  return remainingAccessWalkSec(
    {
      plannedSec: planned,
      arrivalMs,
      distanceM: prev.distance,
      stop: segs[segmentIndex]?.departureStop?.location ?? null,
      position: geo.lngLat.value,
      accuracyM: geo.accuracy.value,
      ridden: prev.mode !== 'walking',
    },
    nowMs.value,
  )
}

/** The rider's "arrive early" margin, in seconds. Read from the transit slice
 *  directly rather than the merged `routingPreferences` — a multimodal trip
 *  resolves those against the biking slice, which carries no transit keys. */
const graceSec = computed(
  () => navigationPreferences.transitBufferMinutes * 60,
)

/** A fix this coarse can't tell a jog that makes it from one that doesn't. */
const RUN_MAX_ACCURACY_M = 100

const runFactor = computed(() => {
  if (!trip.value || !walksToFirstStop(trip.value.segments)) return null
  const accuracy = geo.accuracy.value
  return accuracy != null && accuracy > RUN_MAX_ACCURACY_M ? null : navigationPreferences.runPace
})

function depState(segmentIndex: number, dep: DepartureOption): DepartureReachability {
  return departureReachability(
    dep.ms,
    nowMs.value,
    remainingWalkSec(segmentIndex),
    graceSec.value,
    runFactor.value,
  )
}

/** Minutes late (positive) or early (negative) worth telling the rider about.
 *  Under a minute is timetable noise, not news. */
const DELAY_NOTICE_SEC = 60

/** What is true about a run. Purely factual — how any of it *looks* is the
 *  board's business, not this view's:
 *   • planned     — the run the trip currently boards
 *   • departed    — already gone
 *   • unreachable — upcoming, but probably not on foot in time
 *   • hurry       — you'd make it with less than your margin spare
 *   • arriving    — imminent, i.e. "now"
 *   • cancelled   — pulled by the operator
 *   • live        — the time is a GTFS-RT prediction rather than the schedule
 *   • delaySec    — how far that prediction sits off the timetable
 *  Every card stays selectable regardless — the rider may well know something
 *  the estimate doesn't. */
interface DepCard {
  planned: boolean
  departed: boolean
  unreachable: boolean
  run: boolean
  hurry: boolean
  arriving: boolean
  cancelled: boolean
  /** Published about this specific run, not the whole leg. */
  alert?: ServiceAlert
  live: boolean
  clickable: boolean
  lead: string
  sub: string
  /** Timetabled time, when a live prediction has superseded it. */
  scheduledSub?: string
  delaySec?: number
  route?: DepartureOption['route']
  title: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function depCard(segment: any, segmentIndex: number, dep: DepartureOption): DepCard {
  const planned = isCurrentDeparture(segment, dep.ms)
  // The advice can stay quiet about the planned run (frequent service); the chip still says what it would to any other.
  const adviceReach = planned && boarding.value?.index === segmentIndex ? advice.value?.reach : undefined
  const state = adviceReach && adviceReach !== 'ok' ? adviceReach : depState(segmentIndex, dep)
  const departed = state === 'departed'
  // The reachability hints stand even on the selected card — you still have to
  // rush for (or have likely missed) it — so `planned` doesn't suppress them.
  const unreachable = state === 'unreachable'
  const run = state === 'run'
  const hurry = state === 'hurry'
  const cancelled = dep.cancelled === true
  const { lead, sub } = depCountdown(dep.ms, nowMs.value)
  const arriving = !departed && !cancelled && lead === 'now'
  const name = dep.route?.shortName ?? segment.lineName
  const switchTo = `Switch to the ${name} at ${dep.label}`

  // Only worth showing the timetable alongside the prediction when they
  // actually disagree — otherwise every live card grows a redundant second time.
  const delaySec = dep.delaySec
  const offSchedule =
    delaySec != null &&
    Math.abs(delaySec) >= DELAY_NOTICE_SEC &&
    dep.scheduledMs != null
  const scheduledSub = offSchedule
    ? formatClockCompact(new Date(dep.scheduledMs!))
    : undefined
  const delayPhrase = offSchedule
    ? delaySec! > 0
      ? `${Math.round(delaySec! / 60)} min late`
      : `${Math.round(-delaySec! / 60)} min early`
    : null

  // Only alerts naming this exact run — the leg's own alerts already have a
  // card above the board, and repeating them on twelve chips is noise.
  const runAlert = dep.tripId
    ? (segmentAlerts.value[segmentIndex] ?? []).find((a) =>
        a.informedEntities.some(
          (e) => e.tripId && e.tripId === splitFeedId(dep.tripId!).localId,
        ),
      )
    : undefined

  return {
    planned,
    departed,
    unreachable,
    run,
    hurry,
    arriving,
    cancelled,
    alert: runAlert,
    live: dep.realTime,
    clickable: !planned,
    lead,
    sub,
    scheduledSub,
    delaySec,
    route: dep.route,
    // The tooltip spells out what each badge means the first time someone
    // hovers one, and always says the run is still selectable — the badges
    // are a read on your chances, not a refusal.
    title: cancelled
      ? `Cancelled — the ${name} at ${dep.label} isn't running`
      : planned
        ? joinStatus('Planned departure', delayPhrase)
        : departed
          ? `Departed at ${dep.label}`
          : unreachable
            ? `You may miss this one — the ${name} leaves at ${dep.label}, sooner than you can reach the stop. Pick it anyway if you're closer than we think`
            : run
              ? `Catchable if you run — the ${name} leaves at ${dep.label}`
              : hurry
              ? `Catchable if you hurry — the ${name} leaves at ${dep.label}`
              : joinStatus(switchTo, delayPhrase),
  }
}


/** A run's line in the leg's own colours, which carry any curation the feed's lack. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runRoute(seg: any, shortName: string): DepartureOption['route'] {
  const line = seg.routeOptions?.find((o: { shortName?: string }) => o.shortName === shortName)
    ?? { color: seg.lineColor, textColor: seg.lineTextColor }
  return { shortName, color: line.color ?? undefined, textColor: line.textColor ?? undefined }
}

/** Per-segment board cards, each enriched with its visual state. Recomputes off
 *  the nowMs tick and whenever fresh departures land. */
const boardCards = computed(() => {
  const t = trip.value
  const out: Record<number, Array<DepartureOption & { card: DepCard }>> = {}
  if (!t) return out
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = t.segments as any[]
  for (const [key, deps] of Object.entries(segmentDepartures.value)) {
    const idx = Number(key)
    const seg = segs[idx]
    if (!seg) continue
    out[idx] = deps.map((dep) => ({ ...dep, card: depCard(seg, idx, dep) }))
  }
  return out
})




const hoveredInstructionKey = ref<string | null>(null)

const guidanceStore = useGuidanceStore()
const detailedHazards = computed(() => useAuthService().hasPermission(PermissionId.PREMIUM_NAVIGATION))
const legToStart = computed(() => (trip.value ? guidanceStore.legToStart(trip.value) : null))

async function startGuidance() {
  if (!trip.value || legToStart.value == null) return
  await guidanceStore.start(trip.value, legToStart.value)
  router.push({ name: AppRoute.GUIDANCE })
}

const routePreview = useRoutePreviewStore()
function previewRoute() {
  if (!trip.value || legToStart.value == null) return
  routePreview.open(trip.value, legToStart.value)
  router.push({ name: AppRoute.ROUTE_PREVIEW })
}

const tripId = computed(() => route.params.id as string)

// Server-persisted snapshot (the `pt` capability token in the URL): the
// exact trip as originally planned, immune to schedule drift. Fetched when
// the in-memory plan can't supply the trip — refresh, another device.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const persistedTrip = ref<any | null>(null)
const recovering = ref(false)

async function recoverPersistedTrip() {
  const pt = route.query.pt as string | undefined
  if (!pt || persistedTrip.value || recovering.value) return
  recovering.value = true
  try {
    const { data } = await api.get(`/directions/trips/${pt}`)
    persistedTrip.value = data.trip
  } catch {
    // Unknown/expired snapshot — the sig/re-plan path may still recover it
  } finally {
    recovering.value = false
  }
}

// Trip lookup, most faithful source first:
// 1. exact id in the in-memory plan (same session, or session-cache restore)
// 2. the persisted snapshot (refresh / shared link — exact times)
// 3. signature match against a fresh re-plan (best effort, ids re-minted)
const trip = computed(() => {
  const list = directionsStore.trips?.trips
  const byId = list?.find(t => t.id === tripId.value)
  if (byId) return byId
  if (persistedTrip.value) return persistedTrip.value
  const sig = route.query.sig as string | undefined
  if (!sig || !list) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return list.find(t => tripSignature((t as any).segments) === sig) || null
})

const startEligibility = useStartEligibility(trip, legToStart)

const { adviceFor } = useTripAdvice()
/** The first ride as the board sees it, so the header and the board read the same numbers. */
const boarding = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = (trip.value?.segments ?? []) as any[]
  const i = segs.findIndex((s) => s.mode === 'transit')
  if (i < 1 || segs[i - 1].mode === 'transit') return undefined
  const current = departuresFor(i).find((d) => isCurrentDeparture(segs[i], d.ms))
  return current ? { index: i, departAtMs: current.ms, walkSec: remainingWalkSec(i) } : undefined
})
const advice = computed(() => (trip.value ? adviceFor(trip.value, nowMs.value, boarding.value) : null))


const tight = computed(() => tightChanges(trip.value?.segments ?? []))
/** The tightest change, named once in the header; each one is also flagged where it happens. */
const tightNote = computed(() => {
  const [first] = [...tight.value.values()].sort((a, b) => a.minutes - b.minutes)
  if (!first) return null
  return first.stop
    ? translate('directions.advice.tightChange', { minutes: first.minutes, stop: first.stop })
    : translate('directions.advice.status.change', { minutes: first.minutes })
})
/** No live prediction for the run the trip boards: its times are the timetable's. */
const scheduledOnly = computed(() => {
  if (!advice.value) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segs = (trip.value?.segments ?? []) as any[]
  const i = boardingIndex(segs)
  const current = i >= 0 ? departuresFor(i).find(d => isCurrentDeparture(segs[i], d.ms)) : undefined
  return !(current?.realTime ?? advice.value.live)
})

watch(
  () => [tripId.value, route.query.pt],
  () => {
    const list = directionsStore.trips?.trips
    if (!list?.some(t => t.id === tripId.value)) void recoverPersistedTrip()
  },
  { immediate: true },
)

watch(
  trip,
  () => {
    // A new trip gets its own first-entry default selection + board scroll.
    didAutoSelectDeparture.value = false
    switchedNote.value = null
    void loadDepartures()
  },
  { immediate: true },
)

/**
 * Tell the map which run each leg is riding.
 *
 * The planner names a run with its own encoded token, which the realtime
 * feed has never heard of; the board names it with the feed's own trip id,
 * which is exactly what a vehicle carries. Matching by departure time is
 * what ties the two together — and it re-ties after a rebooking, so the
 * highlighted vehicle follows the train the rider actually picked.
 */
watch(
  [trip, segmentDepartures],
  ([t]) => {
    const ids: Record<number, string> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;((t?.segments ?? []) as any[]).forEach((seg, idx) => {
      if (seg.mode !== 'transit') return
      const run = departuresFor(idx).find((d) => isCurrentDeparture(seg, d.ms))
      if (run?.tripId) ids[idx] = splitFeedId(run.tripId).localId
    })
    tripFocusStore.setLegTripIds(ids)
  },
  { immediate: true },
)

// Keep the URL's id canonical after a signature match, so departure
// rebooking and further shares reference the live trip object.
watch(trip, (t) => {
  if (t && t.id !== tripId.value) {
    router.replace({ params: { id: t.id }, query: route.query }).catch(() => {})
  }
})

// Only bail back to the planner when results have settled and the trip is
// genuinely absent — never mid-recovery while the snapshot fetch or the
// re-plan is in flight.
watch(
  [trip, () => directionsStore.isLoading, recovering],
  ([newTrip, loading, busy]) => {
    if (newTrip === null && !loading && !busy && directionsStore.trips) {
      router.push({ name: AppRoute.DIRECTIONS, query: route.query })
    }
  },
  { immediate: true },
)




watch(
  trip,
  newTrip => {
    if (newTrip) {
      mapService.setVisibleTrips([newTrip.id])
    }
  },
  { immediate: true },
)

onBeforeRouteLeave(to => {
  mapService.setRouteProfile(null)
  if (to.name === AppRoute.DIRECTIONS && tripId.value) {
    mapService.setVisibleTrips([tripId.value])
  }
})

// Tear down on unmount, not in the leave guard: clearing waypoints there fires
// the service's syncUrl watcher, whose router.replace cancels the outgoing
// navigation. `route.name` is the committed destination here.
onUnmounted(() => {
  // The board's run ids belong to this page's boards; the list page has none.
  tripFocusStore.setLegTripIds({})
  // Guidance and the route preview follow this trip and return here on exit.
  const keepsTrip = new Set<unknown>([AppRoute.DIRECTIONS, AppRoute.GUIDANCE, AppRoute.ROUTE_PREVIEW])
  if (keepsTrip.has(route.name)) return
  directionsService.clearTrip()
})

function onInstructionHover(
  segmentIndex: number,
  instrIndex: number,
  instruction: string | RouteInstruction,
) {
  hoveredInstructionKey.value = `${segmentIndex}-${instrIndex}`
  if (typeof instruction === 'object' && instruction.coordinate) {
    mapService.highlightInstructionPoint(segmentIndex, instrIndex)
  }
}

function onInstructionLeave() {
  hoveredInstructionKey.value = null
  mapService.clearHighlightedInstructionPoint()
}


const heroDuration = computed(() => {
  if (!trip.value) return { main: '', suffix: '' }
  const s = trip.value.summary.totalDuration
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  if (hours > 0) return { main: `${hours}h ${minutes}m`, suffix: '' }
  return { main: String(minutes), suffix: 'min' }
})


const formatDistanceDisplay = (meters: number | undefined): string => {
  if (!meters) return formatDistance(0)
  return formatDistance(meters)
}

const formatTime = (date: Date | string): string => {
  return new Date(date).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}


/** The trip-wide colouring picked above the strip; a leg it covers draws by it on the map whether open or not. */
const colorBy = ref<RouteProfileType | null>(null)
/** What each leg asked for itself, by being opened. */
const legProfiles = new Map<number, RouteProfileType | null>()

function applyLegProfile(segmentIndex: number) {
  const segment = trip.value?.segments[segmentIndex]
  if (!segment) return
  const profile = colorBy.value && canColorBy(segment, colorBy.value) ? colorBy.value : legProfiles.get(segmentIndex) ?? null
  mapService.setSegmentRouteProfile(trip.value!.id, segmentIndex, profile)
}

function onRouteProfileChange(segmentIndex: number, profile: RouteProfileType | null) {
  legProfiles.set(segmentIndex, profile)
  applyLegProfile(segmentIndex)
}

watch(() => trip.value?.id, () => {
  legProfiles.clear()
  if (colorBy.value && !tripProfiles(trip.value?.segments ?? []).includes(colorBy.value)) colorBy.value = null
})
watch([colorBy, () => trip.value?.id], () => trip.value?.segments.forEach((_, i) => applyLegProfile(i)))

const routeWaypoints = useRouteWaypoints(() => ({
  waypoints: directionsStore.trips?.request?.waypoints,
  startTime: trip.value?.startTime,
  endTime: trip.value?.endTime,
}))
</script>

<template>
  <!-- PanelLayout: the standard sheet content wrapper — flows into the host
       sheet's single scroll surface with the standard insets, like every other
       sheet page (no nested overflow, which broke drag-to-scroll on mobile). -->
  <PanelLayout>
    <!-- Loading (own state, the snapshot fetch, or the shared planner
         re-creating the trip from a refreshed/shared URL) -->
    <div v-if="!trip && (recovering || directionsStore.isLoading)" class="pt-4" aria-busy="true">
      <div class="flex items-baseline gap-2">
        <Skeleton class="h-9 w-20" />
        <Skeleton class="h-4 w-12" />
      </div>
      <Skeleton class="mt-2 h-4 w-28" />
      <Skeleton class="mt-2 h-4 w-48" />
      <div class="mt-8 space-y-5">
        <div v-for="n in 3" :key="n" class="flex items-center gap-3">
          <Skeleton class="size-7 rounded-full" />
          <div class="flex-1 space-y-1.5">
            <Skeleton class="h-3.5 w-2/5" />
            <Skeleton class="h-3 w-3/5" />
          </div>
        </div>
      </div>
    </div>

    <!-- Trip content -->
    <div v-else-if="trip">
      <!-- Hero, pinned. How long the trip takes and when it leaves is what the
           rest of the panel is read against, so it stays on screen while the
           timeline scrolls under it — the same contract the transit route
           detail uses. The margin cancels PanelLayout's inset and re-adds the
           dock line, so the header's natural position IS where it sticks; see
           `RouteDetailPage` for why any other value breaks. -->
      <SheetHeader
        v-slot="{ stuck }"
        class="-mx-3 mt-[calc(var(--sheet-sticky-top,0px)_-_var(--panel-inset-top,0px))]"
      >
      <div
        class="px-3 md:pt-4 pb-2 border-b transition-colors duration-200"
        :class="stuck ? 'border-border/60' : 'border-transparent'"
      >
      <div class="flex items-end justify-between gap-3">
      <div class="min-w-0">
          <div class="flex items-baseline gap-2">
            <span class="font-display text-[36px] leading-none tracking-tight">
              {{ heroDuration.main }}
            </span>
            <span
              v-if="heroDuration.suffix"
              class="font-display text-[22px] leading-none text-muted-foreground"
            >
              {{ heroDuration.suffix }}
            </span>
            <span class="text-sm text-muted-foreground">
              {{ formatDistanceDisplay(trip.summary.totalDistance) }}
            </span>
          </div>

          <!-- Leave – arrive -->
          <div class="mt-1 text-sm text-muted-foreground tabular-nums">
            {{ formatTime(trip.startTime) }} – {{ formatTime(trip.endTime) }}<template v-if="scheduledOnly"> · {{ translate('directions.advice.status.scheduled') }}</template><template v-if="trip.cost?.total"> · {{ formatCurrency(trip.cost.total) }}</template>
          </div>

          <AdviceStatusLine v-if="advice?.status" :status="advice.status" class="mt-2 text-sm" />
      </div>

        <div class="flex shrink-0 items-center gap-1 -mr-1.5">
          <Button v-if="legToStart != null && startEligibility === 'preview'" size="sm" class="mr-1 gap-1.5 px-3.5" @click="previewRoute">
            <MapIcon class="size-4" />
            {{ translate('guidance.preview.action') }}
          </Button>
          <Button v-else-if="legToStart != null" size="sm" class="mr-1 gap-1.5 px-3.5" @click="startGuidance">
            <NavigationIcon class="size-4" />
            {{ legToStart > 0 ? translate('guidance.startLeg', { leg: legToStart + 1 }) : translate('guidance.start') }}
          </Button>
          <Button variant="ghost" size="icon-md" aria-label="Share">
            <ShareIcon class="size-4" />
          </Button>
          <Button variant="ghost" size="icon-md" aria-label="Save">
            <BookmarkIcon class="size-4" />
          </Button>
        </div>
      </div>

      <div v-if="switchedNote || tightNote" class="mt-3 space-y-1.5 text-xs">
        <p v-if="switchedNote" class="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-muted-foreground">
          <RefreshCwIcon class="size-3.5 shrink-0" />{{ switchedNote }}
        </p>
        <p v-if="tightNote" class="flex items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-amber-800 dark:text-amber-200">
          <TriangleAlertIcon class="size-3.5 shrink-0" />{{ tightNote }}
        </p>
      </div>
      </div>
      </SheetHeader>

      <TripStrip :segments="trip.segments" :waypoints="routeWaypoints" :color-by="colorBy" fold class="pt-4">
        <TripColorLegend :segments="trip.segments" :color-by="colorBy" class="mb-1 pt-1" />
        <template #labels>
          <TripColorPicker v-model="colorBy" :segments="trip.segments" />
        </template>
      </TripStrip>

      <!-- Timezone warning -->
      <div
        v-if="directionsStore.timezoneWarning"
        class="mt-3 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 rounded-lg text-sm"
      >
        <ClockIcon class="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span class="text-amber-800 dark:text-amber-200">
          Your destination is in a different time zone ({{ directionsStore.timezoneWarning.offsetDifferenceText }})
        </span>
      </div>

      <TripTimeline
        class="mt-5"
        :segments="trip.segments"
        :waypoints="routeWaypoints"
        :start-time="trip.startTime"
        :end-time="trip.endTime"
        :alerts="legAlerts"
        :open-alert-id="openLegAlertId"
        :board-cards="boardCards"
        :board-shown="index => departuresFor(index).length > 1"
        :board-key="trip.id"
        :busy="rebooking"
        :hovered-instruction-key="hoveredInstructionKey"
        :detailed-hazards="detailedHazards"
        @toggle-alert="toggleLegAlert"
        @choose-departure="pickDeparture"
        @hover-instruction="onInstructionHover"
        @leave-instruction="onInstructionLeave"
        @route-profile-change="onRouteProfileChange"
      />
    </div>

    <!-- No trip found — and no way to recreate it (the URL carries no
         planning inputs). Recoverable URLs never land here: the shared
         service re-plans from the query and the signature re-finds the trip. -->
    <div v-else class="py-6 flex flex-col items-start gap-1">
      <p class="text-sm font-semibold">{{ translate('directions.tripPage.gone') }}</p>
      <Caption>{{ translate('directions.tripPage.goneBody') }}</Caption>
      <Button variant="outline" size="sm" class="mt-2" @click="router.push({ name: AppRoute.DIRECTIONS, query: route.query })">
        <RefreshCwIcon class="size-4" />
        {{ translate('directions.tripPage.planAgain') }}
      </Button>
    </div>
  </PanelLayout>
</template>

<style scoped>
/* Departure board — clean horizontal scroll, no visible scrollbar */
</style>
