<!--
  Floating dev-only control panel for the GPX simulator.

  Mounted as its own Vue app from `index.ts` so it doesn't share
  context with the main app. No imports from `@/composables`,
  `@/stores`, or `@/components` — keeps the module fully decoupled and
  trivially deletable.
-->

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { parseGpx, trackDurationSec, type GpxPoint } from './gpx-parser'
import { simulatorStore, type SimulatorState } from './simulator-store'

const open = ref(false)
const dragging = ref(false)

// Mirror of the store as a reactive ref so the template re-renders.
const state = ref<SimulatorState>(simulatorStore.getState())

let unsubscribe: (() => void) | null = null

const errorMsg = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const RATE_OPTIONS = [0.5, 1, 2, 4, 8, 16]

onMounted(() => {
  unsubscribe = simulatorStore.subscribe((s) => {
    state.value = s
  })
  window.addEventListener('keydown', handleHotkey)
})

onUnmounted(() => {
  unsubscribe?.()
  window.removeEventListener('keydown', handleHotkey)
})

function handleHotkey(e: KeyboardEvent) {
  // Cmd/Ctrl + Shift + G toggles the panel open/closed.
  const cmdOrCtrl = e.metaKey || e.ctrlKey
  if (cmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'g') {
    e.preventDefault()
    open.value = !open.value
  }
}

async function onFileChosen(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await loadFile(file)
  input.value = ''
}

async function loadFile(file: File) {
  errorMsg.value = null
  try {
    const text = await file.text()
    const points = parseGpx(text)
    simulatorStore.load(file.name, points)
  } catch (err) {
    errorMsg.value =
      err instanceof Error ? err.message : 'Failed to parse GPX'
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) void loadFile(file)
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragging.value = true
}

function onDragLeave() {
  dragging.value = false
}

function play() {
  simulatorStore.play()
}
function pause() {
  simulatorStore.pause()
}
function stop() {
  simulatorStore.stop()
}
function unload() {
  simulatorStore.unload()
}

function onSeek(e: Event) {
  const input = e.target as HTMLInputElement
  const ms = parseFloat(input.value)
  if (Number.isFinite(ms)) simulatorStore.seek(ms)
}

function setRate(rate: number) {
  simulatorStore.setRate(rate)
}

function toggleLoop() {
  simulatorStore.setLoop(!state.value.loop)
}

const hasTrack = computed(() => state.value.points.length > 0)
const isPlaying = computed(() => state.value.status === 'playing')
const isSimulating = computed(
  () => state.value.status === 'playing' || state.value.status === 'paused',
)

const positionLabel = computed(() => {
  const p = state.value.currentPoint
  if (!p) return '—'
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`
})

const speedLabel = computed(() => {
  const p = state.value.currentPoint
  if (!p) return '—'
  return `${p.speed.toFixed(1)} m/s (${(p.speed * 2.237).toFixed(1)} mph)`
})

const headingLabel = computed(() => {
  const p = state.value.currentPoint
  if (!p?.heading == null) return '—'
  return p?.heading != null ? `${p.heading.toFixed(0)}°` : '—'
})

const totalLabel = computed(() => {
  const sec = state.value.totalDurationMs / 1000
  return formatDuration(sec)
})

const elapsedLabel = computed(() => {
  return formatDuration(state.value.trackTimeMs / 1000)
})

const progressPercent = computed(() => {
  if (state.value.totalDurationMs === 0) return 0
  return (state.value.trackTimeMs / state.value.totalDurationMs) * 100
})

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Mark dragging state visually via the chip (when collapsed).
const chipLabel = computed(() => {
  if (state.value.status === 'playing') return `▶ ${state.value.fileName ?? ''}`
  if (state.value.status === 'paused') return `⏸ ${state.value.fileName ?? ''}`
  return 'GPX SIM'
})
</script>

<template>
  <div class="gpx-sim-root" :class="{ open }">
    <button
      v-if="!open"
      class="gpx-sim-chip"
      :class="{ active: isSimulating }"
      @click="open = true"
      title="GPX track simulator (Cmd+Shift+G)"
    >
      {{ chipLabel }}
    </button>

    <div v-else class="gpx-sim-panel">
      <header class="gpx-sim-header">
        <span class="gpx-sim-title">GPX Simulator</span>
        <span class="gpx-sim-hint">dev-only · Cmd+Shift+G</span>
        <button class="gpx-sim-icon-btn" @click="open = false" title="Hide">
          ×
        </button>
      </header>

      <div
        class="gpx-sim-drop"
        :class="{ dragging, has: hasTrack }"
        @drop="onDrop"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
      >
        <template v-if="!hasTrack">
          <div class="gpx-sim-drop-cta">
            <span>Drop a .gpx file here</span>
            <button class="gpx-sim-btn" @click="fileInputRef?.click()">
              Or click to choose
            </button>
          </div>
        </template>
        <template v-else>
          <div class="gpx-sim-loaded">
            <span class="gpx-sim-filename">{{ state.fileName }}</span>
            <span class="gpx-sim-meta">
              {{ state.points.length }} pts · {{ totalLabel }}
            </span>
            <button class="gpx-sim-icon-btn" @click="unload" title="Unload">
              ×
            </button>
          </div>
        </template>
        <input
          ref="fileInputRef"
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          @change="onFileChosen"
          hidden
        />
      </div>

      <div v-if="errorMsg" class="gpx-sim-error">{{ errorMsg }}</div>

      <div v-if="hasTrack" class="gpx-sim-controls">
        <div class="gpx-sim-transport">
          <button
            v-if="!isPlaying"
            class="gpx-sim-btn primary"
            @click="play"
          >
            ▶ Play
          </button>
          <button v-else class="gpx-sim-btn primary" @click="pause">
            ⏸ Pause
          </button>
          <button class="gpx-sim-btn" @click="stop" title="Reset to start">
            ⏹
          </button>
        </div>

        <div class="gpx-sim-row">
          <span class="gpx-sim-time-label">{{ elapsedLabel }}</span>
          <input
            type="range"
            class="gpx-sim-slider"
            :min="0"
            :max="state.totalDurationMs"
            :step="100"
            :value="state.trackTimeMs"
            @input="onSeek"
          />
          <span class="gpx-sim-time-label">{{ totalLabel }}</span>
        </div>

        <div class="gpx-sim-row gpx-sim-rate-row">
          <span class="gpx-sim-rate-label">Speed</span>
          <button
            v-for="rate in RATE_OPTIONS"
            :key="rate"
            class="gpx-sim-rate-btn"
            :class="{ active: state.playbackRate === rate }"
            @click="setRate(rate)"
          >
            {{ rate }}×
          </button>
        </div>

        <label class="gpx-sim-loop">
          <input
            type="checkbox"
            :checked="state.loop"
            @change="toggleLoop"
          />
          <span>Loop</span>
        </label>

        <div class="gpx-sim-stats">
          <div><span>pos</span> {{ positionLabel }}</div>
          <div><span>spd</span> {{ speedLabel }}</div>
          <div><span>hdg</span> {{ headingLabel }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
  No CSS variables from the host app — keeps the module standalone.
  Colors are hard-coded to a neutral dark palette that reads on most
  map backgrounds.
*/

.gpx-sim-root {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 99999;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 12px;
  color: #e6e6e6;
}

.gpx-sim-chip {
  background: rgba(20, 20, 20, 0.9);
  color: #e6e6e6;
  border: 1px solid rgba(255, 255, 255, 0.18);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(8px);
}
.gpx-sim-chip.active {
  border-color: #4ade80;
  color: #4ade80;
}
.gpx-sim-chip:hover {
  background: rgba(40, 40, 40, 0.95);
}

.gpx-sim-panel {
  width: 320px;
  background: rgba(20, 20, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
}

.gpx-sim-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gpx-sim-title {
  font-weight: 600;
  font-size: 12px;
}
.gpx-sim-hint {
  flex: 1;
  font-size: 10px;
  color: #888;
}
.gpx-sim-icon-btn {
  background: transparent;
  border: none;
  color: #aaa;
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
  line-height: 1;
}
.gpx-sim-icon-btn:hover {
  color: #fff;
}

.gpx-sim-drop {
  border: 1px dashed rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  padding: 10px;
  text-align: center;
  transition: border-color 0.15s;
}
.gpx-sim-drop.dragging {
  border-color: #4ade80;
  background: rgba(74, 222, 128, 0.05);
}
.gpx-sim-drop.has {
  border-style: solid;
  text-align: left;
}
.gpx-sim-drop-cta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.gpx-sim-loaded {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gpx-sim-filename {
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.gpx-sim-meta {
  font-size: 10px;
  color: #888;
}

.gpx-sim-error {
  color: #f87171;
  font-size: 11px;
  word-break: break-word;
}

.gpx-sim-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gpx-sim-transport {
  display: flex;
  gap: 6px;
}

.gpx-sim-btn {
  background: rgba(255, 255, 255, 0.08);
  color: #e6e6e6;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 5px;
  padding: 6px 10px;
  font-size: 11px;
  cursor: pointer;
  font-weight: 500;
}
.gpx-sim-btn.primary {
  background: #4ade80;
  color: #042617;
  border-color: #4ade80;
  font-weight: 600;
  flex: 1;
}
.gpx-sim-btn:hover {
  background: rgba(255, 255, 255, 0.14);
}
.gpx-sim-btn.primary:hover {
  background: #6ee79c;
}

.gpx-sim-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.gpx-sim-slider {
  flex: 1;
  accent-color: #4ade80;
}
.gpx-sim-time-label {
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  color: #aaa;
  min-width: 32px;
  text-align: center;
}

.gpx-sim-rate-row {
  flex-wrap: wrap;
}
.gpx-sim-rate-label {
  font-size: 10px;
  color: #aaa;
  margin-right: 4px;
}
.gpx-sim-rate-btn {
  background: transparent;
  color: #aaa;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 10px;
  cursor: pointer;
}
.gpx-sim-rate-btn.active {
  border-color: #4ade80;
  color: #4ade80;
  background: rgba(74, 222, 128, 0.08);
}

.gpx-sim-loop {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #aaa;
  cursor: pointer;
}

.gpx-sim-stats {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: #ccc;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 8px;
}
.gpx-sim-stats span {
  color: #777;
  display: inline-block;
  width: 26px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
</style>
