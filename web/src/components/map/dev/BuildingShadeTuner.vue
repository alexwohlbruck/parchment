<script setup lang="ts">
/**
 * TEMPORARY — a dev-only panel for tuning the 3D building lighting by eye.
 *
 * Open the map with `?tune=shade`. Nothing here ships: the whole component is
 * behind `import.meta.env.DEV`, so it is dropped from a production build.
 *
 * Every lever writes straight onto the live layer, whose options are plain
 * fields read once per frame, so the map updates as you drag. The exceptions
 * are the two that are not layer state: the sun direction also drives the style
 * light (the layer reads its wall shading from there, so they have to move
 * together), and the colour chroma is a paint expression that has to be rebuilt
 * and set on the building layer.
 *
 * "Copy defaults" puts the current values on the clipboard in the shape
 * `building-shade.ts` wants, so a session of tuning ends by pasting rather than
 * by transcribing sixteen numbers.
 */
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { liveBuildingShade, shadeLight, buildingShadeDefaults } from '@/lib/building-shade'
import { buildingColor } from '@/lib/map-style/building-color.mjs'
import { layerGroups } from '@/lib/map-style'
import { mapEventBus } from '@/lib/eventBus'
import { useThemeStore } from '@/stores/theme.store'

type Lever = {
  key: string
  label: string
  min: number
  max: number
  step: number
  /** How the value reads in the panel; purely cosmetic. */
  format?: (v: number) => string
}

const PERCENT = (v: number) => `${Math.round(v * 100)}%`
const PX = (v: number) => `${v.toFixed(1)}px`
const NUM = (v: number) => v.toFixed(2)

const GROUPS: Array<{ title: string; toggle?: { key: string; label: string }; levers: Lever[] }> = [
  {
    title: 'Walls',
    toggle: { key: 'wallShade', label: 'Wall shade' },
    levers: [
      { key: 'strength', label: 'Contact strength', min: 0, max: 1, step: 0.01, format: PERCENT },
      { key: 'band', label: 'Contact height', min: 0.05, max: 1, step: 0.01, format: PERCENT },
      { key: 'edge', label: 'Roofline edge', min: 0, max: 1, step: 0.01, format: PERCENT },
      { key: 'edgeWidth', label: 'Edge width', min: 0, max: 8, step: 0.1, format: PX },
    ],
  },
  {
    title: 'Cast shadow',
    toggle: { key: 'groundFx', label: 'Ground FX' },
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
    levers: [{ key: 'chroma', label: 'Building chroma', min: 0, max: 1.5, step: 0.01, format: NUM }],
  },
]

const themeStore = useThemeStore()
const flavor = computed<'light' | 'dark'>(() => (themeStore.isDark ? 'dark' : 'light'))

const open = ref(true)
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
    if (map.value.getLayer(layerGroups.building3d)) {
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
 * read the flavor's colour back off the live layer instead.
 */
function resolveTokens(expression: unknown): any {
  const current = map.value?.getPaintProperty(layerGroups.building3d, 'fill-extrusion-color')
  const fallback = findColorLiteral(current) ?? '#d9d5c6'
  const walk = (v: any): any =>
    typeof v === 'string' && v.startsWith('@') ? fallback
      : Array.isArray(v) ? v.map(walk)
      : v
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
    '// shared across flavors — the constants above TUNING',
    `SHADOW_OFFSET = [${n(state.shadowX)}, ${n(state.shadowY)}]`,
    `edgeWidth base = ${n(state.edgeWidth / (devicePixelRatio || 1))}  // CSS px`,
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
  mapEventBus.on('load', (m: any) => { map.value = m })
  mapEventBus.on('style.load', (m: any) => {
    map.value = m
    // A style swap builds a fresh layer on the baked defaults; push the panel's
    // values back onto it so a reload does not quietly undo the session.
    setTimeout(apply, 0)
  })
})

watch(state, apply, { deep: true })
watch(toggles, apply, { deep: true })
watch(flavor, () => loadFrom(liveBuildingShade()))
</script>

<template>
  <div
    class="fixed top-20 right-4 z-[60] w-72 rounded-xl border border-border bg-background/95 shadow-lg backdrop-blur text-sm"
  >
    <button
      class="flex w-full items-center justify-between px-3 py-2 font-medium"
      @click="open = !open"
    >
      <span>Building shading</span>
      <span class="text-muted-foreground">{{ open ? '–' : '+' }}</span>
    </button>

    <div v-if="open" class="max-h-[70vh] overflow-y-auto px-3 pb-3">
      <label class="mb-2 flex items-center justify-between">
        <span>Enabled</span>
        <input v-model="toggles.enabled" type="checkbox" />
      </label>

      <div v-for="group in GROUPS" :key="group.title" class="mt-3">
        <div class="mb-1 text-xs text-muted-foreground">{{ group.title }}</div>

        <label v-if="group.toggle" class="mb-1 flex items-center justify-between">
          <span>{{ group.toggle.label }}</span>
          <input v-model="toggles[group.toggle.key]" type="checkbox" />
        </label>

        <div v-for="lever in group.levers" :key="lever.key" class="mb-1.5">
          <div class="flex items-center justify-between text-xs">
            <span>{{ lever.label }}</span>
            <span class="tabular-nums text-muted-foreground">
              {{ lever.format ? lever.format(state[lever.key]) : Math.round(state[lever.key]) }}
            </span>
          </div>
          <input
            v-model.number="state[lever.key]"
            type="range"
            class="w-full accent-primary"
            :min="lever.min"
            :max="lever.max"
            :step="lever.step"
          />
        </div>
      </div>

      <div class="mt-3 flex gap-2">
        <button
          class="flex-1 rounded-md border border-border px-2 py-1.5 hover:bg-muted"
          @click="reset"
        >
          Reset
        </button>
        <button
          class="flex-1 rounded-md bg-primary px-2 py-1.5 text-primary-foreground"
          @click="copyDefaults"
        >
          {{ copied ? 'Copied' : 'Copy defaults' }}
        </button>
      </div>
    </div>
  </div>
</template>
