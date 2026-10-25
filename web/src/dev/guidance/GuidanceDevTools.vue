<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { PauseIcon, PlayIcon, CarFrontIcon, BugIcon, SlidersHorizontalIcon } from 'lucide-vue-next'
import { DEFAULT_CAMERA_TUNING, type CameraTuning } from '@/lib/guidance/camera-framing'
import { Button } from '@/components/ui/button'
import { simulatorStore, type SimulatorState } from '@/dev/gpx-simulator'
import { synthesizeDrive } from '@/dev/gpx-simulator/route-drive'
import { REALISTIC_FIX_MODEL } from '@/dev/gpx-simulator/fix-model'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { attachGuidanceDebug } from './guidance-debug-layer'

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
  simulatorStore.unload()
})

function simulate() {
  const route = guidanceEngine.route
  if (!route) return
  const mode = route.segments[0]?.mode ?? 'driving'
  simulatorStore.load('Route drive', synthesizeDrive(route, mode, Date.now(), Math.floor(Math.random() * 1e9)), REALISTIC_FIX_MODEL)
  simulatorStore.setLoop(false)
  simulatorStore.play()
}

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
