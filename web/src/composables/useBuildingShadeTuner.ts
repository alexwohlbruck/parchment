/**
 * The building-lighting tuning state, shared by the settings section and the
 * floating popover so the two are the same controls in two frames.
 *
 * Every value writes straight onto the live layer, whose options are plain
 * fields read once per frame, so the map updates as a slider moves.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  liveBuildingShade,
  buildingShadeDefaults,
  setShadeLightIntensity,
  setSunOverride,
  shadeLight,
  sunShadow,
} from '@/lib/building-shade'
import { sunPosition } from '@/lib/sun-position'
import { buildingColor } from '@/lib/map-style/building-color.mjs'
import { layerGroups } from '@/lib/map-style'
import { mapEventBus } from '@/lib/eventBus'
import { useThemeStore } from '@/stores/theme.store'
import { useMapStore } from '@/stores/map.store'
import { MapEngine } from '@/types/map.types'

/** Session flag: the popover is open over the map. Dev only. */
export const SHADE_POPOVER_KEY = 'dev:shade-popover'

export type Lever = {
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
const DEG = (v: number) => `${Math.round(v)}°`

export const SHADE_GROUPS: Array<{
  title: string
  toggle?: { key: string; label: string }
  levers: Lever[]
}> = [
  {
    // The sun normally comes from the clock and the map's centre. That is no
    // use for judging how noon reads at seven in the evening, so it can be
    // driven by hand — which also makes the low-sun case reproducible.
    title: 'Sun',
    toggle: { key: 'followSun', label: 'Follow the real sun' },
    levers: [
      // The single biggest control over how dark a wall looks: the shader's
      // ambient floor is 1 - intensity, so a face out of the sun is drawn at
      // that fraction of its lit colour.
      { key: 'intensity', label: 'Sun hardness', min: 0, max: 0.9, step: 0.01, format: PERCENT },
      { key: 'sunAzimuth', label: 'Bearing', min: 0, max: 359, step: 1, format: DEG },
      { key: 'sunAltitude', label: 'Height', min: -5, max: 90, step: 1, format: DEG },
    ],
  },
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
    // Direction and length are not levers: they come from the real sun over the
    // map's centre, and anything set here would be overwritten on the next
    // camera move. Only what the sun does not decide is adjustable.
    title: 'Cast shadow',
    toggle: { key: 'groundFx', label: 'Ground effects' },
    levers: [
      { key: 'shadowAlpha', label: 'Darkness at noon', min: 0, max: 1, step: 0.01, format: PERCENT },
      { key: 'shadowBlur', label: 'Softness', min: 0, max: 20, step: 0.5, format: NUM },
      { key: 'fadeZoom', label: 'Fade-in zooms', min: 0.1, max: 4, step: 0.1, format: NUM },
      { key: 'topDownOpacity', label: 'Top-down opacity', min: 0, max: 1, step: 0.01, format: PERCENT },
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
    levers: [{ key: 'tint', label: 'Tile colour strength', min: 0, max: 90, step: 1 }],
  },
]

export function useBuildingShadeTuner() {
  const themeStore = useThemeStore()
  const mapStore = useMapStore()
  const flavor = computed<'light' | 'dark'>(() => (themeStore.isDark ? 'dark' : 'light'))
  const isMaplibre = computed(() => mapStore.settings.engine === MapEngine.MAPLIBRE)

  const copied = ref(false)
  const map = ref<any>(null)
  const state = reactive<Record<string, number>>({})
  const toggles = reactive<Record<string, boolean>>({
    enabled: true, wallShade: true, groundFx: true, followSun: true,
  })

  /** Flatten the layer's nested options into the flat scalars sliders bind to. */
  function loadFrom(source: any) {
    const d = buildingShadeDefaults(flavor.value)
    const pick = (k: string, fallback: number) =>
      typeof source?.[k] === 'number' ? source[k] : fallback
    Object.assign(state, {
      intensity: d.intensity,
      strength: pick('strength', d.strength),
      band: pick('band', d.band),
      edge: pick('edge', d.edge),
      edgeWidth: pick('edgeWidth', d.edgeWidth),
      shadowAlpha: pick('shadowAlpha', d.shadowAlpha),
      shadowBlur: pick('shadowBlur', d.shadowBlur),
      fadeZoom: pick('fadeZoom', d.fadeZoom),
      topDownOpacity: pick('topDownOpacity', d.topDownOpacity),
      aoIntensity: pick('aoIntensity', d.aoIntensity),
      aoRadiusMin: pick('aoRadiusMin', d.aoRadiusMin),
      aoRadiusMax: pick('aoRadiusMax', d.aoRadiusMax),
      aoZ: source?.aoOffset?.[2] ?? d.aoOffset[2],
      tint: d.tint,
      // Seed the manual sun from wherever the real one is, so releasing the
      // toggle starts from today's sky rather than from an arbitrary angle.
      sunAzimuth: state.sunAzimuth ?? realSunDegrees().azimuth,
      sunAltitude: state.sunAltitude ?? realSunDegrees().altitude,
    })
  }

  /** Today's sun over the map centre, in degrees, for seeding the manual one. */
  function realSunDegrees() {
    const c = map.value?.getCenter?.() ?? { lng: -74, lat: 40.7 }
    const { azimuth, altitude } = sunPosition(new Date(), c.lat, c.lng)
    return {
      azimuth: ((azimuth * 180) / Math.PI + 360) % 360,
      altitude: (altitude * 180) / Math.PI,
    }
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
    layer.fadeZoom = state.fadeZoom
    layer.topDownOpacity = state.topDownOpacity
    layer.aoOffset = [0, state.aoZ / 2, state.aoZ]

    setShadeLightIntensity(state.intensity)
    setSunOverride(
      toggles.followSun
        ? null
        : {
            azimuth: (state.sunAzimuth * Math.PI) / 180,
            altitude: (state.sunAltitude * Math.PI) / 180,
          },
    )

    if (map.value) {
      // The wall shading reads the style light, not the layer, so the intensity
      // only takes effect once the light is set again — with the sun still
      // pointing wherever it currently is.
      const { lng, lat } = map.value.getCenter()
      const sun = sunShadow(new Date(), lat, lng)
      const layerAny = layer as any
      // The override changes direction and length too, not just the light.
      layerAny.shadowOffset = sun.offset
      layerAny._heightScale = sun.heightScale
      layerAny.shadowAlpha = state.shadowAlpha * sun.daylight
      map.value.setLight(shadeLight(sun.offset, sun.altitude))

      if (map.value.getLayer?.(layerGroups.building3d)) {
        map.value.setPaintProperty(
          layerGroups.building3d,
          'fill-extrusion-color',
          resolveTokens(buildingColor(state.tint)),
        )
      }
      map.value.triggerRepaint()
    }
  }

  /**
   * The shared builder emits `@token` placeholders that the style assembler
   * normally resolves at build time. The style is already on the map here, so
   * read the flavor's colour back off the layer instead.
   */
  function resolveTokens(expression: unknown): any {
    const current = map.value?.getPaintProperty(layerGroups.building3d, 'fill-extrusion-color')
    const fallback = findColorLiteral(current) ?? '#ded9c9'
    const walk = (v: any): any =>
      typeof v === 'string' && v.startsWith('@') ? fallback : Array.isArray(v) ? v.map(walk) : v
    return walk(expression)
  }

  /** The last literal colour in an expression — our token's resolved value. */
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
    delete state.sunAzimuth
    delete state.sunAltitude
    loadFrom(buildingShadeDefaults(flavor.value))
    Object.assign(toggles, { enabled: true, wallShade: true, groundFx: true, followSun: true })
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
      `// LIGHT_INTENSITY`,
      `${f}: ${n(state.intensity)}`,
      ...(toggles.followSun
        ? []
        : [`// sun held at bearing ${Math.round(state.sunAzimuth)}deg, height ${Math.round(state.sunAltitude)}deg`]),
      '',
      '// shared across flavors — SHAPE and the constants beside it',
      `EDGE_WIDTH_CSS_PX = ${n(state.edgeWidth / (devicePixelRatio || 1))}`,
      `band = ${n(state.band)}`,
      `shadowBlur = ${n(state.shadowBlur)}`,
      `fadeZoom = ${n(state.fadeZoom)}`,
      `topDownOpacity = ${n(state.topDownOpacity)}`,
      `aoRadiusMin = ${n(state.aoRadiusMin)}`,
      `aoRadiusMax = ${n(state.aoRadiusMax)}`,
      `aoOffset = [0, ${n(state.aoZ / 2)}, ${n(state.aoZ)}]`,
      '',
      '// BUILDING_TINT in src/lib/map-style/building-color.mjs',
      `${f}: ${n(state.tint)}`,
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
      // A style swap builds a fresh layer on the baked defaults; push these
      // values back onto it so a theme change does not undo the session.
      setTimeout(apply, 0)
    })
  })

  watch(state, apply, { deep: true })
  watch(toggles, apply, { deep: true })
  watch(flavor, () => loadFrom(liveBuildingShade()))

  return { state, toggles, flavor, isMaplibre, copied, setLever, reset, copyDefaults }
}
