<!--
  Developer settings page — DEV ONLY.

  Hosts the GPX track simulator UI. The simulator's playback state and
  geolocation override live in the decoupled `@/dev/gpx-simulator/`
  module; this page just renders controls bound to that store.

  This whole page is gated behind `import.meta.env.DEV` via its
  settingsIndex entry — it never appears in production navigation.

  Removing the feature: see the comment in `@/dev/gpx-simulator/index.ts`.
-->

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  CodeIcon,
  FileIcon,
  GaugeIcon,
  MapPinIcon,
  NavigationIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  XIcon,
} from 'lucide-vue-next'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  parseGpx,
  simulatorStore,
  type SimulatorState,
} from '@/dev/gpx-simulator'

const state = ref<SimulatorState>(simulatorStore.getState())
const errorMsg = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = simulatorStore.subscribe((s) => {
    state.value = s
  })
})

onUnmounted(() => {
  unsubscribe?.()
})

const RATE_OPTIONS = [0.5, 1, 2, 4, 8, 16]

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
  return `${p.speed.toFixed(1)} m/s · ${(p.speed * 2.237).toFixed(1)} mph`
})

const headingLabel = computed(() => {
  const p = state.value.currentPoint
  return p?.heading != null ? `${p.heading.toFixed(0)}°` : '—'
})

const totalLabel = computed(() => formatDuration(state.value.totalDurationMs / 1000))
const elapsedLabel = computed(() => formatDuration(state.value.trackTimeMs / 1000))

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

async function loadFile(file: File) {
  errorMsg.value = null
  try {
    const text = await file.text()
    const points = parseGpx(text)
    simulatorStore.load(file.name, points)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to parse GPX'
  }
}

async function onFileChosen(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await loadFile(file)
  input.value = ''
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (file) void loadFile(file)
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
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

function onSeek(values: number[] | number) {
  // shadcn Slider yields an array; tolerate both shapes.
  const ms = Array.isArray(values) ? values[0] : values
  if (Number.isFinite(ms)) simulatorStore.seek(ms)
}

function setRate(rate: number) {
  simulatorStore.setRate(rate)
}

function toggleLoop(value: boolean) {
  simulatorStore.setLoop(value)
}
</script>

<template>
  <div class="flex flex-col gap-4 w-full items-stretch">
    <!--
      GPX track simulator. Replays a recorded GPX file as if it were
      live GPS so we can test location-aware features (friend
      locations, navigation) without physically moving.
    -->
    <SettingsSection
      id="gpx-simulator"
      :title="$t('settings.developer.gpxSimulator.title')"
      :description="$t('settings.developer.gpxSimulator.description')"
    >
      <!-- File picker / current track row -->
      <SettingsItem
        :title="
          hasTrack
            ? state.fileName ?? ''
            : $t('settings.developer.gpxSimulator.noTrack')
        "
        :description="
          hasTrack
            ? $t('settings.developer.gpxSimulator.trackMeta', {
                count: state.points.length,
                duration: totalLabel,
              })
            : $t('settings.developer.gpxSimulator.noTrackHint')
        "
        :icon="FileIcon"
      >
        <div class="flex items-center gap-2">
          <Button
            v-if="hasTrack"
            variant="ghost"
            size="icon"
            @click="unload"
            :title="$t('settings.developer.gpxSimulator.unload')"
          >
            <XIcon class="size-4" />
          </Button>
          <Button variant="outline" size="sm" @click="fileInputRef?.click()">
            {{
              hasTrack
                ? $t('settings.developer.gpxSimulator.replace')
                : $t('settings.developer.gpxSimulator.choose')
            }}
          </Button>
          <input
            ref="fileInputRef"
            type="file"
            accept=".gpx,application/gpx+xml,application/xml,text/xml"
            @change="onFileChosen"
            hidden
          />
        </div>
      </SettingsItem>

      <!--
        Drag/drop target. Only shown when no track is loaded — once a
        track is in, the row above is the swap-target via the file
        picker. Compact so it doesn't dominate the page.
      -->
      <div
        v-if="!hasTrack"
        class="border border-dashed border-muted-foreground/30 rounded-md p-4 text-sm text-muted-foreground text-center"
        @drop="onDrop"
        @dragover="onDragOver"
      >
        {{ $t('settings.developer.gpxSimulator.dropHere') }}
      </div>

      <p v-if="errorMsg" class="text-destructive text-sm">{{ errorMsg }}</p>

      <!-- Transport controls + scrub bar -->
      <template v-if="hasTrack">
        <div class="flex items-center gap-2">
          <Button
            v-if="!isPlaying"
            variant="default"
            size="sm"
            class="flex-1"
            @click="play"
          >
            <PlayIcon class="size-4 mr-1.5" />
            {{ $t('settings.developer.gpxSimulator.play') }}
          </Button>
          <Button v-else variant="default" size="sm" class="flex-1" @click="pause">
            <PauseIcon class="size-4 mr-1.5" />
            {{ $t('settings.developer.gpxSimulator.pause') }}
          </Button>
          <Button
            variant="outline"
            size="icon"
            @click="stop"
            :title="$t('settings.developer.gpxSimulator.reset')"
          >
            <RotateCcwIcon class="size-4" />
          </Button>
        </div>

        <div class="flex items-center gap-3">
          <span class="text-xs text-muted-foreground tabular-nums w-10 text-right">
            {{ elapsedLabel }}
          </span>
          <Slider
            class="flex-1"
            :min="0"
            :max="state.totalDurationMs"
            :step="100"
            :model-value="[state.trackTimeMs]"
            @update:model-value="onSeek($event ?? [0])"
          />
          <span class="text-xs text-muted-foreground tabular-nums w-10">
            {{ totalLabel }}
          </span>
        </div>

        <SettingsItem
          :title="$t('settings.developer.gpxSimulator.playbackSpeed')"
          :icon="GaugeIcon"
        >
          <div class="flex flex-wrap gap-1">
            <Button
              v-for="rate in RATE_OPTIONS"
              :key="rate"
              :variant="state.playbackRate === rate ? 'default' : 'outline'"
              size="sm"
              class="text-xs px-2 h-7"
              @click="setRate(rate)"
            >
              {{ rate }}×
            </Button>
          </div>
        </SettingsItem>

        <SettingsItem
          :title="$t('settings.developer.gpxSimulator.loop')"
          :description="$t('settings.developer.gpxSimulator.loopDescription')"
        >
          <Switch :model-value="state.loop" @update:model-value="toggleLoop" />
        </SettingsItem>

        <!-- Live stats -->
        <SettingsItem
          v-if="isSimulating"
          :title="$t('settings.developer.gpxSimulator.position')"
          :icon="MapPinIcon"
        >
          <span class="text-sm tabular-nums">{{ positionLabel }}</span>
        </SettingsItem>
        <SettingsItem
          v-if="isSimulating"
          :title="$t('settings.developer.gpxSimulator.speed')"
          :icon="GaugeIcon"
        >
          <span class="text-sm tabular-nums">{{ speedLabel }}</span>
        </SettingsItem>
        <SettingsItem
          v-if="isSimulating"
          :title="$t('settings.developer.gpxSimulator.heading')"
          :icon="NavigationIcon"
        >
          <span class="text-sm tabular-nums">{{ headingLabel }}</span>
        </SettingsItem>
      </template>
    </SettingsSection>

    <SettingsSection
      id="dev-info"
      :title="$t('settings.developer.info.title')"
      :description="$t('settings.developer.info.description')"
    >
      <SettingsItem
        :title="$t('settings.developer.info.modeTitle')"
        :description="$t('settings.developer.info.modeDescription')"
        :icon="CodeIcon"
      />
    </SettingsSection>
  </div>
</template>
