<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { PauseIcon, PlayIcon, CarFrontIcon, BugIcon, SlidersHorizontalIcon, SplitIcon, HourglassIcon, TrainFrontIcon, BikeIcon, RouteIcon } from 'lucide-vue-next'
import { DEFAULT_CAMERA_TUNING, type CameraTuning } from '@/lib/guidance/camera-framing'
import { Button } from '@/components/ui/button'
import { simulatorStore, type SimulatorState } from '@/dev/gpx-simulator'
import { synthesizeDetour, synthesizeDrive } from '@/dev/gpx-simulator/route-drive'
import { REALISTIC_FIX_MODEL } from '@/dev/gpx-simulator/fix-model'
import { matchToRoute } from '@/lib/guidance/route-matcher'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { attachGuidanceDebug } from './guidance-debug-layer'
import { guidanceClock } from '@/services/guidance/guidance-clock'
import { setDevStationOverride } from '@/services/guidance/dock-watch.service'
import { MISSED_GRACE_MS, rideStops } from '@/lib/guidance/transit-progress'
import type { NavRoute } from '@/lib/guidance/nav-route'

const props = defineProps<{ alternatives?: { check: () => Promise<void> } }>()

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
const tuningOpen = ref(false)

const guidance = useGuidanceStore()
const sim = ref<SimulatorState>(simulatorStore.getState())
const debugOn = ref(false)
let detachDebug: (() => void) | null = null
let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = simulatorStore.subscribe(state => {
    if (state.status !== sim.value.status || state.playbackRate !== sim.value.playbackRate) {
      sim.value = state
    }
  })
})

onBeforeUnmount(() => {
  unsubscribe?.()
  detachDebug?.()
  guidanceClock.reset()
  setDevStationOverride(null)
  simulatorStore.unload()
})

const STOP_DWELL_SEC = 15

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

function stayOnBoard() {
  const here = simulatorStore.getState().currentPoint
  if (!here) return
  simulatorStore.load('Stay on board', synthesizeDetour(here, Date.now(), { turnDeg: 0, meters: 1500, speed: 10 }), REALISTIC_FIX_MODEL)
  simulatorStore.setLoop(false)
  simulatorStore.play()
}

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
  <div v-if="guidance.isActive" class="flex flex-wrap items-center gap-1.5 rounded-xl border border-dashed p-2">
    <Button v-if="sim.status === 'stopped'" size="sm" variant="secondary" @click="simulate">
      <CarFrontIcon class="size-4" />
      Simulate
    </Button>
    <template v-else>
      <Button
        size="icon-sm"
        variant="secondary"
        @click="sim.status === 'playing' ? simulatorStore.pause() : simulatorStore.play()"
      >
        <PauseIcon v-if="sim.status === 'playing'" class="size-4" />
        <PlayIcon v-else class="size-4" />
      </Button>
      <Button
        v-for="rate in RATES"
        :key="rate"
        size="sm"
        :variant="sim.playbackRate === rate ? 'default' : 'ghost'"
        class="px-2 tabular-nums"
        @click="simulatorStore.setRate(rate)"
      >
        {{ rate }}×
      </Button>
      <Button size="icon-sm" variant="ghost" title="Check routes" @click="props.alternatives?.check()">
        <RouteIcon class="size-4" />
      </Button>
      <Button size="icon-sm" variant="ghost" title="Take a wrong turn" @click="takeWrongTurn">
        <SplitIcon class="size-4" />
      </Button>
      <Button
        v-if="guidance.transit?.kind === 'wait' || guidance.transit?.kind === 'to-stop'"
        size="icon-sm"
        variant="ghost"
        title="Wait too long"
        @click="waitTooLong"
      >
        <HourglassIcon class="size-4" />
      </Button>
      <Button size="sm" :variant="dockForcing === 'filling' ? 'default' : 'ghost'" class="px-2" title="Dock filling" @click="forceDock('filling')">
        <BikeIcon class="size-4" />↓
      </Button>
      <Button size="sm" :variant="dockForcing === 'full' ? 'default' : 'ghost'" class="px-2" title="Dock full" @click="forceDock('full')">
        <BikeIcon class="size-4" />0
      </Button>
      <Button v-if="guidance.transit?.kind === 'riding'" size="icon-sm" variant="ghost" title="Stay on board" @click="stayOnBoard">
        <TrainFrontIcon class="size-4" />
      </Button>
    </template>
    <Button size="icon-sm" :variant="tuningOpen ? 'default' : 'ghost'" class="ml-auto" @click="tuningOpen = !tuningOpen">
      <SlidersHorizontalIcon class="size-4" />
    </Button>
    <Button size="icon-sm" :variant="debugOn ? 'default' : 'ghost'" @click="toggleDebug">
      <BugIcon class="size-4" />
    </Button>
    <div v-if="tuningOpen" class="grid w-full grid-cols-[auto_1fr_3rem] items-center gap-x-2 gap-y-1 pt-1 text-xs">
      <template v-for="(range, key) in TUNING_RANGES" :key="key">
        <span class="text-muted-foreground">{{ key }}</span>
        <input
          v-model.number="guidance.cameraTuning[key]"
          type="range"
          :min="range[0]"
          :max="range[1]"
          :step="range[2]"
        />
        <button class="tabular-nums text-right" @click="guidance.cameraTuning[key] = DEFAULT_CAMERA_TUNING[key]">
          {{ guidance.cameraTuning[key] }}
        </button>
      </template>
    </div>
  </div>
</template>
