<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { BikeIcon, BugIcon, CarFrontIcon, FlaskConicalIcon, HourglassIcon, PauseIcon, PlayIcon, RouteIcon, SignalZeroIcon, SlidersHorizontalIcon, SplitIcon, TrainFrontIcon } from 'lucide-vue-next'
import { DEFAULT_CAMERA_TUNING, type CameraTuning } from '@/lib/guidance/camera-framing'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { simulatorStore, type SimulatorState } from '@/dev/gpx-simulator'
import { synthesizeDetour, synthesizeDrive } from '@/dev/gpx-simulator/route-drive'
import { REALISTIC_FIX_MODEL } from '@/dev/gpx-simulator/fix-model'
import { synthesizeMotion } from '@/dev/gpx-simulator/motion-synth'
import type { GpxPoint } from '@/dev/gpx-simulator/gpx-parser'
import { matchToRoute } from '@/lib/guidance/route-matcher'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { attachGuidanceDebug } from './guidance-debug-layer'
import { simulateNavigation } from './simulate-navigation'
import { guidanceClock } from '@/services/guidance/guidance-clock'
import { setDevStationOverride } from '@/services/guidance/dock-watch.service'
import { MISSED_GRACE_MS, rideStops } from '@/lib/guidance/transit-progress'
import { isAboard } from '@/lib/guidance/guidance-layout'
import { pointAt, type NavRoute } from '@/lib/guidance/nav-route'
import { distanceMeters } from '@/lib/map/movement-interpolation'
import type { LngLat } from '@/types/map.types'

const props = defineProps<{
  /** Which way the panel opens from its pill. */
  placement: 'above' | 'below'
  alternatives?: { check: () => Promise<void> }
  itinerary?: { check: () => Promise<void> }
}>()

const RATES = [1, 2, 4, 8, 16]
const TUNING_RANGES: Record<keyof CameraTuning, [min: number, max: number, step: number]> = {
  aheadSeconds: [5, 60, 1],
  maneuverSeconds: [4, 30, 1],
  pastManeuver: [20, 300, 10],
  cruisePitch: [0, 70, 1],
  maneuverPitch: [0, 70, 1],
  focal: [0.4, 0.9, 0.01],
  lookAheadSeconds: [1, 12, 0.5],
  lookAheadMaxDeg: [0, 90, 5],
}
const TUNING_LABELS: Record<keyof CameraTuning, string> = {
  aheadSeconds: 'Ahead (s)',
  maneuverSeconds: 'Turn (s)',
  pastManeuver: 'Past turn (m)',
  cruisePitch: 'Cruise tilt',
  maneuverPitch: 'Turn tilt',
  focal: 'Puck height',
  lookAheadSeconds: 'Look ahead (s)',
  lookAheadMaxDeg: 'Look ahead max°',
}
const open = ref(false)
const tuningOpen = ref(false)

const guidance = useGuidanceStore()
const sim = ref<SimulatorState>(simulatorStore.getState())
const debugOn = ref(false)
let detachDebug: (() => void) | null = null
let unsubscribe: (() => void) | null = null

let lastWallMs = performance.now()

onMounted(() => {
  unsubscribe = simulatorStore.subscribe(state => {
    if (state.status !== sim.value.status || state.playbackRate !== sim.value.playbackRate) {
      sim.value = state
    }
    // Aboard, the timetable runs at playback speed so the vehicle keeps to it.
    const wallMs = performance.now()
    if (state.status === 'playing' && isAboard(guidance.transit)) guidanceClock.advance((wallMs - lastWallMs) * (state.playbackRate - 1))
    lastWallMs = wallMs
    if (underground.value && !state.outages.length) leaveUnderground()
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  leaveUnderground()
  detachDebug?.()
  guidanceClock.reset()
  setDevStationOverride(null)
  simulatorStore.unload()
})

const STOP_DWELL_SEC = 25

/** Dwell at every intermediate stop of each ride. */
function transitDwells(route: NavRoute) {
  return guidance.segments.flatMap((segment, i) =>
    segment.mode === 'transit' ? rideStops(route, i, segment).slice(1, -1).map(stop => ({ s: stop.s, sec: STOP_DWELL_SEC })) : [],
  )
}

function simulate() {
  const route = guidanceEngine.route
  if (!route) return
  const mode = route.segments[0]?.mode ?? 'driving'
  const drive = synthesizeDrive(route, mode, Date.now(), Math.floor(Math.random() * 1e9), { stops: transitDwells(route) })
  simulatorStore.load('Route drive', drive, REALISTIC_FIX_MODEL)
  simulatorStore.setLoop(false)
  simulatorStore.play()
}

function takeWrongTurn() {
  const here = simulatorStore.getState().currentPoint
  if (!here) return
  simulatorStore.load('Wrong turn', synthesizeDetour(here, Date.now()), REALISTIC_FIX_MODEL)
  simulatorStore.setLoop(false)
  simulatorStore.play()
}

// The simulated walk reaches the stop early; bring the timetable to it.
watch(
  () => guidance.transit?.kind,
  kind => {
    const stage = guidance.transit
    if (kind !== 'wait' || stage?.kind !== 'wait' || sim.value.status === 'stopped') return
    const ahead = stage.departureMs - 20_000 - guidanceClock.now()
    if (ahead > 0) guidanceClock.advance(ahead)
  },
)

function waitTooLong() {
  const stage = guidance.transit
  if (stage?.kind !== 'wait' && stage?.kind !== 'to-stop') return
  simulatorStore.pause()
  guidanceClock.advance(stage.departureMs + MISSED_GRACE_MS + 5000 - guidanceClock.now())
}

const dockForcing = ref<'filling' | 'full' | null>(null)

/** Each poll the station loses two bikes and docks, or has none at all. */
function forceDock(kind: 'filling' | 'full') {
  dockForcing.value = dockForcing.value === kind ? null : kind
  if (!dockForcing.value) return setDevStationOverride(null)
  let left = 7
  setDevStationOverride(status => {
    left = kind === 'full' ? 0 : Math.max(0, left - 2)
    return { ...status, bikes: left, docks: left }
  })
}

const UNDERGROUND_APPROACH_METERS = 100
const SURFACE_METERS = 60
const underground = ref(false)
let stopMotion: (() => void) | null = null

/** Track time when the trip first comes within a few metres of `target`, after the playback position. */
function trackTimeNear(points: GpxPoint[], target: LngLat, afterMs: number): number | null {
  const start = points[0]?.time ?? 0
  const point = points.find(p => p.time - start >= afterMs && distanceMeters(p, target) < 5)
  return point ? point.time - start : null
}

/** No fixes from the platform, or from here if already aboard, until out at the far end; motion carries on. */
function goUnderground() {
  if (underground.value) return leaveUnderground()
  const route = guidanceEngine.route
  const state = simulatorStore.getState()
  const index = guidance.transit?.segmentIndex ?? guidance.segments.findIndex(s => s.mode === 'transit')
  const ride = route?.segments[index]
  if (!route || !ride) return
  const now = state.trackTimeMs
  const fromMs = guidance.transit?.kind === 'riding' ? now : trackTimeNear(state.points, pointAt(route, ride.startDistance - UNDERGROUND_APPROACH_METERS), now) ?? now
  const toMs = trackTimeNear(state.points, pointAt(route, Math.min(route.length, ride.endDistance + SURFACE_METERS)), fromMs) ?? state.totalDurationMs
  simulatorStore.setOutages([{ fromMs, toMs }])
  stopMotion ??= synthesizeMotion()
  underground.value = true
}

function leaveUnderground() {
  stopMotion?.()
  stopMotion = null
  underground.value = false
  simulatorStore.setOutages([])
}

watch(() => sim.value.status, status => status === 'stopped' && leaveUnderground())

function stayOnBoard() {
  const here = simulatorStore.getState().currentPoint
  if (!here) return
  simulatorStore.load('Stay on board', synthesizeDetour(here, Date.now(), { turnDeg: 0, meters: 1500, speed: 10 }), REALISTIC_FIX_MODEL)
  simulatorStore.setLoop(false)
  simulatorStore.play()
}

// With simulation on in developer settings, each route is driven as soon as there is one to follow.
watch(
  () => guidance.route,
  route => {
    if (route && simulateNavigation.value && simulatorStore.getState().status === 'stopped') simulate()
  },
  { immediate: true },
)

// A simulated driver follows the new route after a reroute, as a real one would:
// joining it from where they are, at the speed they're doing.
watch(
  () => guidance.route,
  (route, previous) => {
    const here = simulatorStore.getState().currentPoint
    if (!route || !previous || !here || sim.value.status === 'stopped') return
    const startS = matchToRoute(route, here)?.s ?? 0
    const mode = route.segments[0]?.mode ?? 'driving'
    const rate = simulatorStore.getState().playbackRate
    simulatorStore.load(
      'Route drive',
      synthesizeDrive(route, mode, Date.now(), Math.floor(Math.random() * 1e9), { startS, startSpeed: here.speed, stops: transitDwells(route) }),
      REALISTIC_FIX_MODEL,
    )
    simulatorStore.setLoop(false)
    simulatorStore.setRate(rate)
    simulatorStore.play()
  },
)

function toggleDebug() {
  const map = useMapStore().getMapStrategy()?.mapInstance as MaplibreMap | undefined
  if (!map) return
  if (detachDebug) {
    detachDebug()
    detachDebug = null
  } else {
    detachDebug = attachGuidanceDebug(map)
  }
  debugOn.value = detachDebug != null
}
</script>

<template>
  <div v-if="guidance.isActive" class="nav-surface pointer-events-auto relative">
    <Button
      size="icon"
      class="size-12 rounded-full shadow-lg [&_svg]:size-5"
      :variant="open ? 'default' : 'secondary'"
      title="Navigation dev tools"
      @click="open = !open"
    >
      <FlaskConicalIcon />
    </Button>
    <span
      v-if="sim.status !== 'stopped'"
      class="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground tabular-nums"
    >
      {{ sim.playbackRate }}×
    </span>
    <div
      v-if="open"
      class="nav-card absolute z-10 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-3 p-4"
      :class="placement === 'above' ? 'bottom-full right-0 mb-2' : 'left-0 top-full mt-2'"
    >
      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-medium text-muted-foreground">Simulation</h3>
        <Button v-if="sim.status === 'stopped'" variant="secondary" class="rounded-full" @click="simulate">
          <CarFrontIcon />
          Drive the route
        </Button>
        <div v-else class="flex items-center gap-1">
          <Button
            size="icon"
            variant="secondary"
            class="rounded-full"
            :title="sim.status === 'playing' ? 'Pause' : 'Play'"
            @click="sim.status === 'playing' ? simulatorStore.pause() : simulatorStore.play()"
          >
            <PauseIcon v-if="sim.status === 'playing'" />
            <PlayIcon v-else />
          </Button>
          <div class="ml-auto flex rounded-full bg-secondary p-0.5">
            <button
              v-for="rate in RATES"
              :key="rate"
              class="h-8 rounded-full px-2.5 text-xs font-medium tabular-nums transition-colors"
              :class="sim.playbackRate === rate ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="simulatorStore.setRate(rate)"
            >
              {{ rate }}×
            </button>
          </div>
        </div>
      </section>

      <section v-if="sim.status !== 'stopped'" class="flex flex-col gap-2">
        <h3 class="text-xs font-medium text-muted-foreground">Scenarios</h3>
        <div class="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" class="rounded-full" @click="takeWrongTurn">
            <SplitIcon />
            Wrong turn
          </Button>
          <Button size="sm" variant="secondary" class="rounded-full" @click="props.alternatives?.check()">
            <RouteIcon />
            Check routes
          </Button>
          <Button v-if="guidance.segments.some(s => s.mode === 'transit')" size="sm" variant="secondary" class="rounded-full" @click="props.itinerary?.check()">
            <TrainFrontIcon />
            Check plans
          </Button>
          <Button
            v-if="guidance.transit?.kind === 'wait' || guidance.transit?.kind === 'to-stop'"
            size="sm"
            variant="secondary"
            class="rounded-full"
            @click="waitTooLong"
          >
            <HourglassIcon />
            Miss it
          </Button>
          <Button
            v-if="guidance.segments.some(s => s.mode === 'transit')"
            size="sm"
            :variant="underground ? 'default' : 'secondary'"
            class="rounded-full"
            @click="goUnderground"
          >
            <SignalZeroIcon />
            Underground
          </Button>
          <Button v-if="guidance.transit?.kind === 'riding'" size="sm" variant="secondary" class="rounded-full" @click="stayOnBoard">
            <TrainFrontIcon />
            Stay on board
          </Button>
          <Button size="sm" :variant="dockForcing === 'filling' ? 'default' : 'secondary'" class="rounded-full" @click="forceDock('filling')">
            <BikeIcon />
            Dock filling
          </Button>
          <Button size="sm" :variant="dockForcing === 'full' ? 'default' : 'secondary'" class="rounded-full" @click="forceDock('full')">
            <BikeIcon />
            Dock full
          </Button>
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-medium text-muted-foreground">Inspect</h3>
        <div class="flex gap-1.5">
          <Button size="sm" :variant="tuningOpen ? 'default' : 'secondary'" class="rounded-full" @click="tuningOpen = !tuningOpen">
            <SlidersHorizontalIcon />
            Camera
          </Button>
          <Button size="sm" :variant="debugOn ? 'default' : 'secondary'" class="rounded-full" @click="toggleDebug">
            <BugIcon />
            Overlay
          </Button>
        </div>
        <div v-if="tuningOpen" class="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-x-3 gap-y-2.5 pt-1 text-xs">
          <template v-for="(range, key) in TUNING_RANGES" :key="key">
            <span class="text-muted-foreground">{{ TUNING_LABELS[key] }}</span>
            <Slider
              :model-value="[guidance.cameraTuning[key]]"
              :min="range[0]"
              :max="range[1]"
              :step="range[2]"
              @update:model-value="value => value && (guidance.cameraTuning[key] = value[0])"
            />
            <button
              class="text-right tabular-nums hover:text-primary"
              title="Reset"
              @click="guidance.cameraTuning[key] = DEFAULT_CAMERA_TUNING[key]"
            >
              {{ guidance.cameraTuning[key] }}
            </button>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>
