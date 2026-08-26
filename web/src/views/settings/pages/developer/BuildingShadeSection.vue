<!--
  Building lighting — DEV ONLY, rendered by the Developer settings page.

  Tunes the 3D building shading live: cast shadows, ground occlusion, the wall
  contact band, the roofline edge, and how much colour the tiles contribute.
  Every value writes straight onto the layer, whose options are plain fields
  read once per frame, so the map behind the settings dialog updates as you drag.

  MapLibre only — the Mapbox strategy lights its buildings natively and ignores
  all of this, so the section says so rather than appearing broken.

  "Copy defaults" puts the current values on the clipboard already shaped for
  `TUNING` in `@/lib/building-shade` and `BUILDING_CHROMA` in
  `@/lib/map-style/building-color`, so a tuning session ends by pasting rather
  than by transcribing fifteen numbers.
-->

<script setup lang="ts">
import { computed, reactive, ref, watch, onMounted } from 'vue'
import { BuildingIcon, CopyIcon, RotateCcwIcon } from 'lucide-vue-next'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  liveBuildingShade,
  shadeLight,
  buildingShadeDefaults,
} from '@/lib/building-shade'
import { buildingColor } from '@/lib/map-style/building-color.mjs'
import { layerGroups } from '@/lib/map-style'
import { mapEventBus } from '@/lib/eventBus'
import { useThemeStore } from '@/stores/theme.store'
import { useMapStore } from '@/stores/map.store'
import { MapEngine } from '@/types/map.types'

type Lever = {
  key: string
  label: string
  min: number
  max: number
  step: number
  format?: (v: number) => string
}

const PERCENT = (v: number) => `${Math.round(v * 100)}%`
const PX = (v: number) => `${v.toFixed(2)}px`
const NUM = (v: number) => v.toFixed(2)

const GROUPS: Array<{ title: string; toggle?: { key: string; label: string }; levers: Lever[] }> = [
  {
    title: 'Walls',
    toggle: { key: 'wallShade', label: 'Wall shading' },
    levers: [
      { key: 'strength', label: 'Contact strength', min: 0, max: 1, step: 0.01, format: PERCENT },
      { key: 'band', label: 'Contact height', min: 0.05, max: 1, step: 0.01, format: PERCENT },
      { key: 'edge', label: 'Roofline edge', min: 0, max: 1, step: 0.01, format: PERCENT },
      { key: 'edgeWidth', label: 'Edge width', min: 0, max: 8, step: 0.05, format: PX },
    ],
  },
  {
    title: 'Cast shadow',
    toggle: { key: 'groundFx', label: 'Ground effects' },
    levers: [
      { key: 'shadowX', label: 'Sun X', min: -2, max: 2, step: 0.05, format: NUM },
      { key: 'shadowY', label: 'Sun Y', min: -2, max: 2, step: 0.05, format: NUM },
      { key: 'heightScale', label: 'Length', min: 0, max: 1.5, step: 0.01, format: PERCENT },
      { key: 'shadowAlpha', label: 'Darkness', min: 0, max: 1, step: 0.01, format: PERCENT },
      { key: 'shadowBlur', label: 'Softness', min: 0, max: 20, step: 0.5, format: NUM },
    ],
  },
  {
    title: 'Ground occlusion',
    levers: [
      { key: 'aoIntensity', label: 'Intensity', min: 0, max: 2, step: 0.01, format: NUM },
      { key: 'aoRadiusMin', label: 'Radius min', min: 0, max: 200, step: 1 },
      { key: 'aoRadiusMax', label: 'Radius max', min: 0, max: 400, step: 1 },
      { key: 'aoZ', label: 'Falloff', min: -20, max: 20, step: 0.5, format: NUM },
    ],
  },
  {
    title: 'Colour',
    levers: [{ key: 'chroma', label: 'Tile colour strength', min: 0, max: 1.5, step: 0.01, format: NUM }],
  },
]

const themeStore = useThemeStore()
const mapStore = useMapStore()
const flavor = computed<'light' | 'dark'>(() => (themeStore.isDark ? 'dark' : 'light'))
const isMaplibre = computed(() => mapStore.settings.engine === MapEngine.MAPLIBRE)

const copied = ref(false)
const map = ref<any>(null)
const state = reactive<Record<string, number>>({})
const toggles = reactive<Record<string, boolean>>({ enabled: true, wallShade: true, groundFx: true })

/** Flatten the layer's nested options into the flat scalars the sliders bind to. */
function loadFrom(source: any) {
  const d = buildingShadeDefaults(flavor.value)
  const pick = (k: string, fallback: number) => (typeof source?.[k] === 'number' ? source[k] : fallback)
  Object.assign(state, {
    strength: pick('strength', d.strength),
    band: pick('band', d.band),
    edge: pick('edge', d.edge),
    edgeWidth: pick('edgeWidth', d.edgeWidth),
    shadowX: source?.shadowOffset?.[0] ?? d.shadowOffset[0],
    shadowY: source?.shadowOffset?.[1] ?? d.shadowOffset[1],
    heightScale: pick('_heightScale', d.heightScale),
    shadowAlpha: pick('shadowAlpha', d.shadowAlpha),
    shadowBlur: pick('shadowBlur', d.shadowBlur),
    aoIntensity: pick('aoIntensity', d.aoIntensity),
    aoRadiusMin: pick('aoRadiusMin', d.aoRadiusMin),
    aoRadiusMax: pick('aoRadiusMax', d.aoRadiusMax),
    aoZ: source?.aoOffset?.[2] ?? d.aoOffset[2],
    chroma: d.chroma,
  })
}

function apply() {
  const layer = liveBuildingShade() as any
  if (!layer) return
  layer.enabled = toggles.enabled
  layer.wallShade = toggles.wallShade
  layer.groundFx = toggles.groundFx
  layer.strength = state.strength
  layer.band = state.band
  layer.edge = state.edge
  layer.edgeWidth = state.edgeWidth
  layer.shadowAlpha = state.shadowAlpha
  layer.shadowBlur = state.shadowBlur
  layer.aoIntensity = state.aoIntensity
  layer.aoRadiusMin = state.aoRadiusMin
  layer.aoRadiusMax = state.aoRadiusMax
  // Underscored on the layer because upstream treats them as construction-time
  // options; they are still read every frame, so assigning works.
  layer._heightScale = state.heightScale
  layer.shadowOffset = [state.shadowX, state.shadowY]
  layer.aoOffset = [0, state.aoZ / 2, state.aoZ]

  if (map.value) {
    // Wall shading comes from the style light, not the layer, so the sun has to
    // be moved in both places or the two disagree.
    map.value.setLight(shadeLight([state.shadowX, state.shadowY]))
    if (map.value.getLayer?.(layerGroups.building3d)) {
      map.value.setPaintProperty(
        layerGroups.building3d,
        'fill-extrusion-color',
        resolveTokens(buildingColor(state.chroma)),
      )
    }
    map.value.triggerRepaint()
  }
}

/**
 * The shared builder emits `@token` placeholders, which the style assembler
 * normally resolves at build time. Here the style is already on the map, so
 * read the flavor's colour back off the layer instead.
 */
function resolveTokens(expression: unknown): any {
  const current = map.value?.getPaintProperty(layerGroups.building3d, 'fill-extrusion-color')
  const fallback = findColorLiteral(current) ?? '#ded9c9'
  const walk = (v: any): any =>
    typeof v === 'string' && v.startsWith('@') ? fallback : Array.isArray(v) ? v.map(walk) : v
  return walk(expression)
}

/** The last literal colour string in an expression — our token's resolved value. */
function findColorLiteral(v: any): string | null {
  if (typeof v === 'string') return /^(#|rgb|hsl)/.test(v) ? v : null
  if (!Array.isArray(v)) return null
  for (let i = v.length - 1; i >= 0; i--) {
    const found = findColorLiteral(v[i])
    if (found) return found
  }
  return null
}

function setLever(key: string, value: number[] | undefined) {
  if (!value?.length) return
  state[key] = value[0]
}

function reset() {
  loadFrom(buildingShadeDefaults(flavor.value))
  Object.assign(toggles, { enabled: true, wallShade: true, groundFx: true })
  apply()
}

function copyDefaults() {
  const f = flavor.value
  const n = (v: number) => Number(v.toFixed(3))
  const snippet = [
    `// ${f} flavor — paste into TUNING in src/lib/building-shade.ts`,
    `${f}: { shadowAlpha: ${n(state.shadowAlpha)}, aoIntensity: ${n(state.aoIntensity)}, `
      + `strength: ${n(state.strength)}, edge: ${n(state.edge)} },`,
    '',
    '// shared across flavors — SHAPE and the constants beside it',
    `SHADOW_OFFSET = [${n(state.shadowX)}, ${n(state.shadowY)}]`,
    `EDGE_WIDTH_CSS_PX = ${n(state.edgeWidth / (devicePixelRatio || 1))}`,
    `band = ${n(state.band)}`,
    `heightScale = ${n(state.heightScale)}`,
    `shadowBlur = ${n(state.shadowBlur)}`,
    `aoRadiusMin = ${n(state.aoRadiusMin)}`,
    `aoRadiusMax = ${n(state.aoRadiusMax)}`,
    `aoOffset = [0, ${n(state.aoZ / 2)}, ${n(state.aoZ)}]`,
    '',
    '// BUILDING_CHROMA in src/lib/map-style/building-color.mjs',
    `${f}: ${n(state.chroma)}`,
  ].join('\n')
  navigator.clipboard.writeText(snippet)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
  console.log(snippet)
}

// Synchronously, not in onMounted: the template formats every value on its
// first render, which happens before mount, and a missing number throws there.
loadFrom(liveBuildingShade())

onMounted(() => {
  mapEventBus.on('load', (m: any) => (map.value = m))
  mapEventBus.on('style.load', (m: any) => {
    map.value = m
    // A style swap builds a fresh layer on the baked defaults; push these values
    // back onto it so a theme change does not quietly undo the session.
    setTimeout(apply, 0)
  })
})

watch(state, apply, { deep: true })
watch(toggles, apply, { deep: true })
watch(flavor, () => loadFrom(liveBuildingShade()))
</script>

<template>
  <SettingsSection
    id="building-shading"
    :title="$t('settings.developer.buildingShading.title')"
    :description="$t('settings.developer.buildingShading.description')"
  >
    <SettingsItem
      v-if="!isMaplibre"
      title="MapLibre only"
      description="The Mapbox engine lights its buildings itself and ignores these. Switch the map engine under Behavior to use them."
      :icon="BuildingIcon"
    />

    <template v-else>
      <SettingsItem
        title="Enabled"
        description="Turn the whole effect off to compare against plain extrusions."
        :icon="BuildingIcon"
      >
        <Switch :model-value="toggles.enabled" @update:model-value="toggles.enabled = $event" />
      </SettingsItem>

      <template v-for="group in GROUPS" :key="group.title">
        <SettingsItem v-if="group.toggle" :title="group.toggle.label">
          <Switch
            :model-value="toggles[group.toggle.key]"
            @update:model-value="toggles[group.toggle.key] = $event"
          />
        </SettingsItem>

        <SettingsItem
          v-for="lever in group.levers"
          :key="lever.key"
          :title="lever.label"
          :description="group.title"
          block
        >
          <div class="flex items-center gap-3 w-56">
            <Slider
              class="flex-1"
              :min="lever.min"
              :max="lever.max"
              :step="lever.step"
              :model-value="[state[lever.key]]"
              @update:model-value="setLever(lever.key, $event ?? undefined)"
            />
            <span class="text-xs text-muted-foreground tabular-nums w-12 text-right">
              {{ lever.format ? lever.format(state[lever.key]) : Math.round(state[lever.key]) }}
            </span>
          </div>
        </SettingsItem>
      </template>

      <SettingsItem
        title="Save these values"
        description="Copies the current settings in the shape building-shade.ts expects."
        :icon="CopyIcon"
      >
        <div class="flex gap-2">
          <Button variant="outline" size="sm" @click="reset">
            <RotateCcwIcon class="size-4" />
            Reset
          </Button>
          <Button size="sm" @click="copyDefaults">
            {{ copied ? 'Copied' : 'Copy defaults' }}
          </Button>
        </div>
      </SettingsItem>
    </template>
  </SettingsSection>
</template>
