<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { PauseIcon, PlayIcon, CarFrontIcon, BugIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { simulatorStore, type SimulatorState } from '@/dev/gpx-simulator'
import { synthesizeDrive } from '@/dev/gpx-simulator/route-drive'
import { REALISTIC_FIX_MODEL } from '@/dev/gpx-simulator/fix-model'
import { useMapStore } from '@/stores/map.store'
import { useGuidanceStore } from '@/stores/guidance.store'
import { guidanceEngine } from '@/services/guidance/guidance-engine.service'
import { attachGuidanceDebug } from './guidance-debug-layer'

const RATES = [1, 2, 4, 8, 16]

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
    <Button size="icon-sm" :variant="debugOn ? 'default' : 'ghost'" class="ml-auto" @click="toggleDebug">
      <BugIcon class="size-4" />
    </Button>
  </div>
</template>
