<script setup lang="ts">
import { watch, onMounted, onUnmounted, ref, computed } from 'vue'
import { useMapService } from '@/services/map.service'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { mapEventBus } from '@/lib/eventBus'
import { useHotkeys } from '@/composables/useHotkeys'
import MeasureDot from './MeasureDot.vue'
import {
  pathLengthMeters,
  polygonAreaSquareMeters,
  findSegmentToInsert,
  shouldCloseLoop,
  distancePx,
  formatMeasureDistance,
  formatMeasureArea,
  formatMeasureDistanceInUnit,
  formatMeasureAreaInUnit,
  getSmartDistanceUnitIndex,
  getSmartAreaUnitIndex,
  DISTANCE_UNITS,
  AREA_UNITS,
  INSERT_THRESHOLD_PX,
  CLOSE_LOOP_THRESHOLD_PX,
  VERTEX_NEAR_PX,
} from '@/lib/measure.utils'
import type { UnitSystem as MeasureUnitSystem } from '@/lib/measure.utils'
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app.store'
import { useThemeStore } from '@/stores/theme.store'
import { UnitSystem } from '@/types/map.types'
import type { LngLat } from '@/types/map.types'
import { useI18n } from 'vue-i18n'
import { themeHslToHex, getThemeColorHex, adjustLightness } from '@/lib/utils'
import { XIcon } from 'lucide-vue-next'
import { Switch } from '@/components/ui/switch'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  MEASURE_FILL_SOURCE_ID,
  MEASURE_FILL_LAYER_ID,
  MEASURE_LINE_CASE_LAYER_ID,
  EMPTY_MEASURE_LINE_GEOJSON,
  EMPTY_MEASURE_FILL_GEOJSON,
  MEASURE_FILL_LAYER_SPEC,
  MEASURE_LINE_CASE_LAYER_SPEC,
  MEASURE_LINE_LAYER_SPEC,
} from '@/constants/layer.constants'

const mapService = useMapService()
const mapToolsStore = useMapToolsStore()
const appStore = useAppStore()
const themeStore = useThemeStore()
const { t, locale } = useI18n()
const { unitSystem } = storeToRefs(appStore)
const { measurePoints, isMeasureClosed } = storeToRefs(mapToolsStore)

/** Current drag position (updates live so distance/area recompute during drag). */
const draggingState = ref<{ index: number; lngLat: LngLat } | null>(null)

/** Points to use for display: store points with dragging point overridden when dragging. */
const effectiveMeasurePoints = computed(() => {
  const pts = measurePoints.value
  const drag = draggingState.value
  if (!drag || drag.index < 0 || drag.index >= pts.length) return pts
  const out = pts.map((p, i) => (i === drag.index ? drag.lngLat : p))
  if (isMeasureClosed.value && pts.length > 0) {
    if (drag.index === 0) out[out.length - 1] = drag.lngLat
    if (drag.index === pts.length - 1) out[0] = drag.lngLat
  }
  return out
})

/** Measure panel unit: default to app unit system (settings > behavior), then user can toggle. */
const measureUnitSystem = ref<MeasureUnitSystem>(
  unitSystem.value === UnitSystem.IMPERIAL ? 'imperial' : 'metric',
)
const {
  pushMeasureState,
  measureUndo,
  measureRedo,
  MEASURE_SOURCE_ID,
  MEASURE_LAYER_ID,
} = mapToolsStore

const isActive = computed(() => mapToolsStore.activeTool === 'measure')

watch(isActive, active => {
  if (active) {
    measureUnitSystem.value =
      unitSystem.value === UnitSystem.IMPERIAL ? 'imperial' : 'metric'
    distanceDisplayUnitIndex.value = 0
    areaDisplayUnitIndex.value = 0
    distanceUnitCycled.value = false
    areaUnitCycled.value = false
  }
})

watch(measureUnitSystem, () => {
  distanceDisplayUnitIndex.value = 0
  areaDisplayUnitIndex.value = 0
  distanceUnitCycled.value = false
  areaUnitCycled.value = false
})

/** Index into DISTANCE_UNITS[measureUnitSystem] for cycle-on-click */
const distanceDisplayUnitIndex = ref(0)
/** Index into AREA_UNITS[measureUnitSystem] for cycle-on-click */
const areaDisplayUnitIndex = ref(0)
/** When false, distance uses smart units; when true, uses cycled unit. */
const distanceUnitCycled = ref(false)
/** When false, area uses smart units; when true, uses cycled unit. */
const areaUnitCycled = ref(false)

// Total distance in meters (uses effective points so it updates during drag)
const totalDistanceMeters = computed(() =>
  pathLengthMeters(effectiveMeasurePoints.value),
)

const distanceUnits = computed(() => DISTANCE_UNITS[measureUnitSystem.value])
const areaUnits = computed(() => AREA_UNITS[measureUnitSystem.value])

/** Current distance string: smart units until user clicks to cycle. */
const distanceHint = computed(() => {
  const m = totalDistanceMeters.value
  if (m === 0) return null
  if (!distanceUnitCycled.value)
    return formatMeasureDistance(m, measureUnitSystem.value, locale.value)
  const units = distanceUnits.value
  const idx = Math.min(distanceDisplayUnitIndex.value, units.length - 1)
  return formatMeasureDistanceInUnit(m, units[idx], locale.value)
})

// Area when closed loop (uses effective points for live drag)
const areaSquareMeters = computed(() => {
  if (!isMeasureClosed.value || effectiveMeasurePoints.value.length < 3)
    return 0
  return polygonAreaSquareMeters(effectiveMeasurePoints.value)
})

/** Current area string: smart units until user clicks to cycle. */
const areaHint = computed(() => {
  const a = areaSquareMeters.value
  if (a === 0) return null
  if (!areaUnitCycled.value)
    return formatMeasureArea(a, measureUnitSystem.value, locale.value)
  const units = areaUnits.value
  const idx = Math.min(areaDisplayUnitIndex.value, units.length - 1)
  return formatMeasureAreaInUnit(a, units[idx], locale.value)
})

function cycleDistanceUnit() {
  const m = totalDistanceMeters.value
  const units = distanceUnits.value
  if (!distanceUnitCycled.value) {
    distanceUnitCycled.value = true
    distanceDisplayUnitIndex.value = getSmartDistanceUnitIndex(
      m,
      measureUnitSystem.value,
    )
  }
  distanceDisplayUnitIndex.value =
    (distanceDisplayUnitIndex.value + 1) % units.length
}

function cycleAreaUnit() {
  const a = areaSquareMeters.value
  const units = areaUnits.value
  if (!areaUnitCycled.value) {
    areaUnitCycled.value = true
    areaDisplayUnitIndex.value = getSmartAreaUnitIndex(
      a,
      measureUnitSystem.value,
    )
  }
  areaDisplayUnitIndex.value = (areaDisplayUnitIndex.value + 1) % units.length
}

function setLineSourceData(coords: number[][]) {
  const map = mapService.mapStrategy?.mapInstance
  if (!map || !map.getSource(MEASURE_SOURCE_ID)) return
  const source = map.getSource(MEASURE_SOURCE_ID) as any
  if (!source) return
  if (coords.length >= 2) {
    source.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    })
  } else {
    source.setData(EMPTY_MEASURE_LINE_GEOJSON)
  }
}

function setFillSourceData(ring: number[][] | null) {
  const map = mapService.mapStrategy?.mapInstance
  if (!map || !map.getSource(MEASURE_FILL_SOURCE_ID)) return
  const source = map.getSource(MEASURE_FILL_SOURCE_ID) as any
  if (!source) return
  if (ring && ring.length >= 4) {
    source.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    })
  } else {
    source.setData(EMPTY_MEASURE_FILL_GEOJSON)
  }
}

function updateMeasureLineSource() {
  const coords = measurePoints.value.map(p => [p.lng, p.lat])
  if (coords.length >= 2) {
    const closed = isMeasureClosed.value && coords.length >= 3
    const ring = closed ? [...coords, coords[0]] : coords
    setLineSourceData(ring)
    setFillSourceData(closed ? ring : null)
  } else {
    setLineSourceData([])
    setFillSourceData(null)
  }
}

/** Update line (and fill when closed) during drag without changing measure state (no history push). */
function updateMeasureLineSourceWithOverride(
  draggedIndex: number,
  lngLat: LngLat,
) {
  const pts = measurePoints.value
  const coords = pts.map((p, i) => {
    if (isMeasureClosed.value) {
      if (draggedIndex === 0 && i === pts.length - 1)
        return [lngLat.lng, lngLat.lat]
      if (draggedIndex === pts.length - 1 && i === 0)
        return [lngLat.lng, lngLat.lat]
    }
    return i === draggedIndex ? [lngLat.lng, lngLat.lat] : [p.lng, p.lat]
  })
  if (coords.length >= 2) {
    const ring = isMeasureClosed.value ? [...coords, coords[0]] : coords
    setLineSourceData(ring)
    if (isMeasureClosed.value && ring.length >= 4) setFillSourceData(ring)
  }
}

/** Theme primary as hex for MapLibre (from theme store – same source as Tailwind --primary). */
function getMeasureLineColor(): string {
  const hex = themeHslToHex(themeStore.themePrimary)
  return hex ?? getThemeColorHex('text-primary')
}

/** Darker primary for line casing (derived from theme primary so it’s never green). */
function getMeasureLineCasingColor(): string {
  const primary = getMeasureLineColor()
  return adjustLightness(primary, -22)
}

function setMeasureLineColor() {
  const map = mapService.mapStrategy?.mapInstance
  if (!map || !map.getStyle()) return
  if (map.getLayer(MEASURE_LAYER_ID)) {
    map.setPaintProperty(MEASURE_LAYER_ID, 'line-color', getMeasureLineColor())
  }
  if (map.getLayer(MEASURE_LINE_CASE_LAYER_ID)) {
    map.setPaintProperty(
      MEASURE_LINE_CASE_LAYER_ID,
      'line-color',
      getMeasureLineCasingColor(),
    )
  }
  if (map.getLayer(MEASURE_FILL_LAYER_ID)) {
    map.setPaintProperty(
      MEASURE_FILL_LAYER_ID,
      'fill-color',
      getMeasureLineColor(),
    )
  }
}

function addMeasureLayers() {
  const map = mapService.mapStrategy?.mapInstance
  if (!map || !map.getStyle()) return
  if (map.getSource(MEASURE_SOURCE_ID)) return
  map.addSource(MEASURE_SOURCE_ID, {
    type: 'geojson',
    data: EMPTY_MEASURE_LINE_GEOJSON,
  })
  map.addSource(MEASURE_FILL_SOURCE_ID, {
    type: 'geojson',
    data: EMPTY_MEASURE_FILL_GEOJSON,
  })
  map.addLayer({
    id: MEASURE_FILL_LAYER_ID,
    ...MEASURE_FILL_LAYER_SPEC,
    paint: {
      ...MEASURE_FILL_LAYER_SPEC.paint,
      'fill-color': getMeasureLineColor(),
    },
  })
  map.addLayer({
    id: MEASURE_LINE_CASE_LAYER_ID,
    ...MEASURE_LINE_CASE_LAYER_SPEC,
    paint: {
      ...MEASURE_LINE_CASE_LAYER_SPEC.paint,
      'line-color': getMeasureLineCasingColor(),
    },
  })
  map.addLayer({
    id: MEASURE_LAYER_ID,
    ...MEASURE_LINE_LAYER_SPEC,
    paint: {
      ...MEASURE_LINE_LAYER_SPEC.paint,
      'line-color': getMeasureLineColor(),
    },
  })
}

function removeMeasureLayers() {
  const map = mapService.mapStrategy?.mapInstance
  if (!map || !map.getStyle()) return
  if (map.getLayer(MEASURE_LAYER_ID)) map.removeLayer(MEASURE_LAYER_ID)
  if (map.getLayer(MEASURE_LINE_CASE_LAYER_ID))
    map.removeLayer(MEASURE_LINE_CASE_LAYER_ID)
  if (map.getLayer(MEASURE_FILL_LAYER_ID))
    map.removeLayer(MEASURE_FILL_LAYER_ID)
  if (map.getSource(MEASURE_SOURCE_ID)) map.removeSource(MEASURE_SOURCE_ID)
  if (map.getSource(MEASURE_FILL_SOURCE_ID))
    map.removeSource(MEASURE_FILL_SOURCE_ID)
}

const MEASURE_MARKER_PREFIX = 'measure-dot-'

function removeMeasureMarkers() {
  mapService.removeMarkersByPrefix?.(MEASURE_MARKER_PREFIX)
}

function syncMeasureMarkers() {
  removeMeasureMarkers()
  const pts = measurePoints.value
  // If closed loop, the last point is identical to the first, so don't render a duplicate marker for it.
  const markersToRender = isMeasureClosed.value ? pts.slice(0, -1) : pts

  markersToRender.forEach((p, i) => {
    const isFirst = i === 0
    mapService.addVueMarker(
      `${MEASURE_MARKER_PREFIX}${i}`,
      p,
      MeasureDot,
      {
        index: i,
        isFirst,
        onRemove: () => removePointAt(i),
      },
      undefined,
      {
        onDragEnd: (lngLat: LngLat) => {
          draggingState.value = null
          const next = [...measurePoints.value]
          if (i >= 0 && i < next.length) {
            next[i] = lngLat
            if (isMeasureClosed.value && i === 0) next[next.length - 1] = lngLat
            pushMeasureState(next)
          }
        },
        onDrag: (lngLat: LngLat) => {
          draggingState.value = { index: i, lngLat }
          updateMeasureLineSourceWithOverride(i, lngLat)
        },
      },
    )
  })
}

function removePointAt(index: number) {
  const points = measurePoints.value
  if (index === 0 && points.length >= 3 && !isMeasureClosed.value) {
    // Clicking first dot with 3+ points (when not closed): close the loop instead of removing
    pushMeasureState([...points, { ...points[0] }])
    return
  }

  // In a closed loop, clicking the first dot disconnects the loop by removing only the last (duplicate) point
  if (isMeasureClosed.value && index === 0) {
    pushMeasureState(points.slice(0, -1))
    return
  }

  const next = points.filter((_, i) => i !== index)
  pushMeasureState(next)
}

function handleMapClick(data: {
  lngLat: LngLat
  point: { x: number; y: number }
}) {
  const points = measurePoints.value
  const project = (lngLat: LngLat) => mapService.project(lngLat)
  const click = { lngLat: data.lngLat, point: data.point }

  if (!project(data.lngLat)) {
    pushMeasureState([...points, data.lngLat])
    return
  }

  if (isMeasureClosed.value) {
    const insert = findSegmentToInsert(
      points,
      click,
      project,
      INSERT_THRESHOLD_PX,
    )
    if (insert) {
      const startPx = project(points[insert.segmentIndex])
      const endPx = project(points[insert.segmentIndex + 1])
      const insertPx = project(insert.point)
      const nearStart =
        startPx && insertPx && distancePx(insertPx, startPx) < VERTEX_NEAR_PX
      const nearEnd =
        endPx && insertPx && distancePx(insertPx, endPx) < VERTEX_NEAR_PX
      if (!nearStart && !nearEnd) {
        const next = [...points]
        next.splice(insert.segmentIndex + 1, 0, insert.point)
        pushMeasureState(next)
      }
    }
    return
  }

  const insert = findSegmentToInsert(
    points,
    click,
    project,
    INSERT_THRESHOLD_PX,
  )
  if (insert) {
    const startPx = project(points[insert.segmentIndex])
    const endPx = project(points[insert.segmentIndex + 1])
    const insertPx = project(insert.point)
    const nearStart =
      startPx && insertPx && distancePx(insertPx, startPx) < VERTEX_NEAR_PX
    const nearEnd =
      endPx && insertPx && distancePx(insertPx, endPx) < VERTEX_NEAR_PX
    if (!nearStart && !nearEnd) {
      const next = [...points]
      next.splice(insert.segmentIndex + 1, 0, insert.point)
      pushMeasureState(next)
      return
    }
  }
  if (shouldCloseLoop(points, click, project, CLOSE_LOOP_THRESHOLD_PX)) {
    pushMeasureState([...points, { ...points[0] }])
    return
  }
  pushMeasureState([...points, data.lngLat])
}

let clickHandler:
  | ((data: { lngLat: LngLat; point: { x: number; y: number } }) => void)
  | null = null

function setupClickOverride() {
  if (clickHandler) return
  clickHandler = handleMapClick
  mapEventBus.setOverride('click', clickHandler)
}

function teardownClickOverride() {
  if (clickHandler) {
    mapEventBus.removeOverride('click', clickHandler)
    clickHandler = null
  }
}

// Undo/redo hotkeys only when measure tool is active
useHotkeys([
  {
    key: ['mod', 'z'],
    handler: () => {
      if (isActive.value) {
        measureUndo()
      }
    },
    id: 'measure-undo',
    name: 'Measure undo',
    description: 'Undo last measure point change',
  },
  {
    key: ['mod', 'y'],
    handler: () => {
      if (isActive.value) {
        measureRedo()
      }
    },
    id: 'measure-redo',
    name: 'Measure redo',
    description: 'Redo measure point change',
  },
  {
    key: ['escape'],
    handler: () => {
      if (isActive.value) {
        closeMeasure()
      }
    },
    id: 'measure-close',
    name: 'Close measure tool',
    description: 'Close the measure tool',
  },
])

watch(
  () => [isActive.value, measurePoints.value] as const,
  ([active, points]) => {
    if (!active) {
      draggingState.value = null
      teardownClickOverride()
      removeMeasureLayers()
      removeMeasureMarkers()
      return
    }
    setupClickOverride()
    addMeasureLayers()
    updateMeasureLineSource()
    syncMeasureMarkers()
  },
  { immediate: true, deep: true },
)

// Re-add layers after style load (e.g. theme change)
mapEventBus.on('style.load', () => {
  if (isActive.value) {
    addMeasureLayers()
    updateMeasureLineSource()
    syncMeasureMarkers()
  }
})

// Update line color when light/dark or accent theme changes
watch(
  () => themeStore.themePrimary,
  () => {
    if (isActive.value) setMeasureLineColor()
  },
)

onMounted(() => {
  if (isActive.value) {
    addMeasureLayers()
    updateMeasureLineSource()
    syncMeasureMarkers()
  }
})

onUnmounted(() => {
  teardownClickOverride()
  removeMeasureLayers()
  removeMeasureMarkers()
})

function closeMeasure() {
  mapToolsStore.setActiveTool('none')
}
</script>

<template>
  <div v-if="isActive" class="pointer-events-auto max-w-96 shrink-0">
    <Card
      class="rounded-xl border-border/60 bg-background/90 backdrop-blur-sm shadow-sm"
    >
      <CardHeader
        class="flex flex-row items-center justify-between px-3.5 py-2"
      >
        <CardTitle class="mb-0 text-[15px] font-semibold tracking-[-0.02em]">{{
          t('measure.title')
        }}</CardTitle>
        <Button
          variant="ghost"
          size="icon"
          class="size-7 shrink-0 -my-1 -mr-2"
          :aria-label="t('measure.close')"
          @click="closeMeasure"
        >
          <XIcon class="size-4" />
        </Button>
      </CardHeader>

      <CardContent class="flex flex-col gap-3 px-3.5 pb-3 pt-0">
        <template v-if="measurePoints.length >= 2">
          <div class="flex flex-col gap-1.5">
            <div class="flex items-baseline justify-between gap-4">
              <Label
                class="shrink-0 text-[11px] font-medium text-muted-foreground"
                >{{
                  t(isMeasureClosed ? 'measure.perimeter' : 'measure.distance')
                }}</Label
              >
              <button
                type="button"
                class="cursor-pointer rounded -mx-1 bg-transparent px-1 text-right text-[13px] font-medium tracking-[-0.02em] text-foreground tabular-nums transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="t('measure.cycleUnit')"
                @click="cycleDistanceUnit"
              >
                {{ distanceHint ?? '—' }}
              </button>
            </div>
            <div
              v-if="areaHint"
              class="flex items-baseline justify-between gap-4"
            >
              <Label
                class="shrink-0 text-[11px] font-medium text-muted-foreground"
                >{{ t('measure.area') }}</Label
              >
              <button
                type="button"
                class="cursor-pointer rounded -mx-1 bg-transparent px-1 text-right text-[13px] font-medium tracking-[-0.02em] text-foreground tabular-nums transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="t('measure.cycleUnit')"
                @click="cycleAreaUnit"
              >
                {{ areaHint }}
              </button>
            </div>
          </div>
          <div class="mt-1 flex items-center justify-between gap-3">
            <Label class="text-[11px] font-medium text-muted-foreground">{{
              t('measure.unitsMetric')
            }}</Label>
            <div class="flex flex-1 justify-center">
              <Switch
                :model-value="measureUnitSystem === 'imperial'"
                @update:model-value="
                  v => (measureUnitSystem = v ? 'imperial' : 'metric')
                "
                aria-label="Metric or Imperial units"
              />
            </div>
            <Label
              class="shrink-0 text-[11px] font-medium text-muted-foreground"
              >{{ t('measure.unitsImperial') }}</Label
            >
          </div>
        </template>
        <p v-else class="m-0 text-[13px] leading-[1.4] text-muted-foreground">
          {{ t('measure.empty') }}
        </p>
      </CardContent>
    </Card>
  </div>
</template>
