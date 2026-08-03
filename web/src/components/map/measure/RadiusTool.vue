<script setup lang="ts">
import { watch, onMounted, onUnmounted, ref, computed } from 'vue'
import * as turf from '@turf/turf'
import { useMapService } from '@/services/map.service'
import { useMapToolsStore } from '@/stores/map-tools.store'
import { mapEventBus } from '@/lib/eventBus'
import { useHotkeys } from '@/composables/useHotkeys'
import { useMeasureUnits } from '@/composables/useMeasureUnits'
import MeasureToolPanel from './MeasureToolPanel.vue'
import MeasureReadout from './MeasureReadout.vue'
import UnitSystemToggle from './UnitSystemToggle.vue'
import MeasureDot from './MeasureDot.vue'
import {
  distanceMeters,
  circleCircumferenceMeters,
  circleAreaSquareMeters,
} from '@/lib/measure.utils'
import type { UnitSystem as MeasureUnitSystem } from '@/lib/measure.utils'
import { storeToRefs } from 'pinia'
import { useAppStore } from '@/stores/app.store'
import { useThemeStore } from '@/stores/theme.store'
import { UnitSystem } from '@/types/map.types'
import type { LngLat } from '@/types/map.types'
import { useI18n } from 'vue-i18n'
import { themeHslToHex, getThemeColorHex, adjustLightness } from '@/lib/utils'
import {
  RADIUS_SOURCE_ID,
  RADIUS_FILL_LAYER_ID,
  RADIUS_LINE_LAYER_ID,
  EMPTY_RADIUS_GEOJSON,
  RADIUS_FILL_LAYER_SPEC,
  RADIUS_LINE_LAYER_SPEC,
} from '@/constants/layer.constants'

const mapService = useMapService()
const mapToolsStore = useMapToolsStore()
const appStore = useAppStore()
const themeStore = useThemeStore()
const { t, locale } = useI18n()
const { unitSystem } = storeToRefs(appStore)
const { radiusCenter, radiusEdgePoint, radiusMeters, radiusConfirmed } =
  storeToRefs(mapToolsStore)
const {
  setRadiusCenter,
  setRadiusEdgePoint,
  setRadiusMeters,
  confirmRadius,
  clearRadius,
} = mapToolsStore

const RADIUS_CENTER_MARKER_ID = 'radius-center-dot'
const RADIUS_EDGE_MARKER_ID = 'radius-edge-dot'

/** Skip syncRadiusMarkers during drag so we don't remove/re-add the marker being dragged. */
const isDraggingCenter = ref(false)
const isDraggingEdge = ref(false)

const isActive = computed(() => mapToolsStore.activeTool === 'radius')

const {
  system: radiusUnitSystem,
  formatDistance,
  formatArea,
  cycleDistance,
  cycleArea,
} = useMeasureUnits(isActive)

const circumferenceMeters = computed(() =>
  circleCircumferenceMeters(radiusMeters.value),
)
const areaSquareMeters = computed(() => circleAreaSquareMeters(radiusMeters.value))

const radiusHint = computed(() => formatDistance(radiusMeters.value))
const circumferenceHint = computed(() => formatDistance(circumferenceMeters.value))
const areaHint = computed(() => formatArea(areaSquareMeters.value))

function getRadiusLineColor(): string {
  const hex = themeHslToHex(themeStore.themePrimary)
  return hex ?? getThemeColorHex('text-primary')
}

function getRadiusLineCasingColor(): string {
  return adjustLightness(getRadiusLineColor(), -22)
}

function setRadiusCircleSource(
  feature: GeoJSON.Feature<GeoJSON.Polygon> | null,
) {
  const map = mapService.mapStrategy?.mapInstance
  if (!map || !map.getSource(RADIUS_SOURCE_ID)) return
  const source = map.getSource(RADIUS_SOURCE_ID) as { setData: (d: unknown) => void }
  if (!source) return
  if (feature && feature.geometry.coordinates[0].length >= 3) {
    source.setData(feature)
  } else {
    source.setData(EMPTY_RADIUS_GEOJSON)
  }
}

function updateRadiusCircle() {
  const center = radiusCenter.value
  const radius = radiusMeters.value
  if (!center || radius <= 0) {
    setRadiusCircleSource(null)
    return
  }
  const circle = turf.circle([center.lng, center.lat], radius, {
    units: 'meters',
    steps: 64,
  })
  setRadiusCircleSource(circle)
}

function setRadiusLayerColors() {
  const map = mapService.mapStrategy?.mapInstance
  if (!map || !map.getStyle()) return
  const color = getRadiusLineColor()
  const casingColor = getRadiusLineCasingColor()
  if (map.getLayer(RADIUS_LINE_LAYER_ID)) {
    map.setPaintProperty(RADIUS_LINE_LAYER_ID, 'line-color', color)
  }
  if (map.getLayer(RADIUS_FILL_LAYER_ID)) {
    map.setPaintProperty(RADIUS_FILL_LAYER_ID, 'fill-color', color)
  }
}

function addRadiusLayers() {
  const map = mapService.mapStrategy?.mapInstance
  if (!map || !map.getStyle()) return
  if (map.getSource(RADIUS_SOURCE_ID)) return
  map.addSource(RADIUS_SOURCE_ID, {
    type: 'geojson',
    data: EMPTY_RADIUS_GEOJSON,
  })
  map.addLayer({
    id: RADIUS_FILL_LAYER_ID,
    ...RADIUS_FILL_LAYER_SPEC,
    paint: {
      ...RADIUS_FILL_LAYER_SPEC.paint,
      'fill-color': getRadiusLineColor(),
    },
  })
  map.addLayer({
    id: RADIUS_LINE_LAYER_ID,
    ...RADIUS_LINE_LAYER_SPEC,
    paint: {
      ...RADIUS_LINE_LAYER_SPEC.paint,
      'line-color': getRadiusLineColor(),
    },
  })
}

function removeRadiusLayers() {
  const map = mapService.mapStrategy?.mapInstance
  if (!map || !map.getStyle()) return
  if (map.getLayer(RADIUS_LINE_LAYER_ID)) map.removeLayer(RADIUS_LINE_LAYER_ID)
  if (map.getLayer(RADIUS_FILL_LAYER_ID))
    map.removeLayer(RADIUS_FILL_LAYER_ID)
  if (map.getSource(RADIUS_SOURCE_ID)) map.removeSource(RADIUS_SOURCE_ID)
}

function removeRadiusMarkers() {
  mapService.removeMarker?.(RADIUS_CENTER_MARKER_ID)
  mapService.removeMarker?.(RADIUS_EDGE_MARKER_ID)
}

function syncRadiusMarkers() {
  removeRadiusMarkers()
  const center = radiusCenter.value
  if (!center) return
  const confirmed = radiusConfirmed.value
  const edge = radiusEdgePoint.value
  const centerDragOptions =
    confirmed && edge
      ? {
          onDrag: (newLngLat: LngLat) => {
            isDraggingCenter.value = true
            const prev = radiusCenter.value
            const prevEdge = radiusEdgePoint.value
            if (!prev || !prevEdge) return
            const delta = {
              lng: newLngLat.lng - prev.lng,
              lat: newLngLat.lat - prev.lat,
            }
            const newEdge = {
              lng: prevEdge.lng + delta.lng,
              lat: prevEdge.lat + delta.lat,
            }
            setRadiusCenter(newLngLat)
            setRadiusEdgePoint(newEdge)
            // Move edge marker in place so it follows the circle (avoids duplicate "left behind" dot)
            mapService.setMarkerLngLat?.(RADIUS_EDGE_MARKER_ID, newEdge)
          },
          onDragEnd: (newLngLat: LngLat) => {
            const prev = radiusCenter.value
            const prevEdge = radiusEdgePoint.value
            if (!prev || !prevEdge) return
            const delta = {
              lng: newLngLat.lng - prev.lng,
              lat: newLngLat.lat - prev.lat,
            }
            setRadiusCenter(newLngLat)
            setRadiusEdgePoint({
              lng: prevEdge.lng + delta.lng,
              lat: prevEdge.lat + delta.lat,
            })
            isDraggingCenter.value = false
            // Don't sync here: watch will run on store change and sync once (avoids duplicate center/edge)
          },
        }
      : undefined
  mapService.addVueMarker(
    RADIUS_CENTER_MARKER_ID,
    center,
    MeasureDot,
    {
      index: 0,
      isFirst: true,
      onRemove: () => {
        clearRadius()
      },
    },
    undefined,
    centerDragOptions,
  )
  if (confirmed && edge) {
    mapService.addVueMarker(
      RADIUS_EDGE_MARKER_ID,
      edge,
      MeasureDot,
      {
        index: 1,
        isFirst: false,
        onRemove: () => {},
      },
      undefined,
      {
        onDrag: (newLngLat: LngLat) => {
          isDraggingEdge.value = true
          setRadiusEdgePoint(newLngLat)
          const c = radiusCenter.value
          if (c) setRadiusMeters(distanceMeters(c, newLngLat))
        },
        onDragEnd: (newLngLat: LngLat) => {
          setRadiusEdgePoint(newLngLat)
          const c = radiusCenter.value
          if (c) setRadiusMeters(distanceMeters(c, newLngLat))
          isDraggingEdge.value = false
          // Don't sync here: watch will run on store change and sync once (avoids duplicate center)
        },
      },
    )
  }
}

let clickHandler:
  | ((data: { lngLat: LngLat; point: { x: number; y: number } }) => void)
  | null = null
let mouseMoveHandler: ((e: { lngLat: LngLat }) => void) | null = null

function handleMapClick(data: { lngLat: LngLat }) {
  const center = radiusCenter.value
  if (!center) {
    setRadiusCenter(data.lngLat)
    return
  }
  if (radiusConfirmed.value) return
  const meters = distanceMeters(center, data.lngLat)
  setRadiusEdgePoint(data.lngLat)
  setRadiusMeters(meters)
  confirmRadius()
}

function setupClickOverride() {
  if (clickHandler) return
  clickHandler = (data: { lngLat: LngLat }) => handleMapClick(data)
  mapEventBus.setOverride('click', clickHandler)
}

function teardownClickOverride() {
  if (clickHandler) {
    mapEventBus.removeOverride('click', clickHandler)
    clickHandler = null
  }
}

function setupMouseMove() {
  const map = mapService.mapStrategy?.mapInstance
  if (!map || mouseMoveHandler) return
  mouseMoveHandler = (e: { lngLat: LngLat }) => {
    const center = radiusCenter.value
    if (!center || radiusConfirmed.value) return
    const meters = distanceMeters(center, e.lngLat)
    setRadiusMeters(meters)
  }
  ;(map as { on: (ev: string, fn: (e: { lngLat: LngLat }) => void) => void }).on(
    'mousemove',
    mouseMoveHandler,
  )
}

function teardownMouseMove() {
  const map = mapService.mapStrategy?.mapInstance as
    | { off: (ev: string, fn: (e: { lngLat: LngLat }) => void) => void }
    | undefined
  if (!map || !mouseMoveHandler) return
  map.off('mousemove', mouseMoveHandler)
  mouseMoveHandler = null
}

useHotkeys([
  {
    key: ['escape'],
    handler: () => {
      if (isActive.value) closeRadius()
    },
    id: 'radius-close',
    name: 'Close radius tool',
    description: 'Close the radius tool',
  },
])

watch(
  () =>
    [
      isActive.value,
      radiusCenter.value,
      radiusEdgePoint.value,
      radiusMeters.value,
      radiusConfirmed.value,
    ] as const,
  ([active, center, confirmed]) => {
    if (!active) {
      teardownClickOverride()
      teardownMouseMove()
      removeRadiusLayers()
      removeRadiusMarkers()
      return
    }
    setupClickOverride()
    addRadiusLayers()
    if (center) {
      if (!isDraggingCenter.value && !isDraggingEdge.value) {
        syncRadiusMarkers()
      }
      if (!confirmed) {
        setupMouseMove()
      } else {
        teardownMouseMove()
      }
      updateRadiusCircle()
    } else {
      teardownMouseMove()
      removeRadiusMarkers()
      updateRadiusCircle()
    }
  },
  { immediate: true, deep: true },
)

watch(
  () => [radiusCenter.value, radiusMeters.value],
  () => {
    if (isActive.value && radiusCenter.value) updateRadiusCircle()
  },
)

mapEventBus.on('style.load', () => {
  if (isActive.value) {
    addRadiusLayers()
    updateRadiusCircle()
    setRadiusLayerColors()
    syncRadiusMarkers()
  }
})

watch(
  () => themeStore.themePrimary,
  () => {
    if (isActive.value) setRadiusLayerColors()
  },
)

onMounted(() => {
  if (isActive.value && radiusCenter.value) {
    addRadiusLayers()
    updateRadiusCircle()
    syncRadiusMarkers()
  }
})

onUnmounted(() => {
  teardownClickOverride()
  teardownMouseMove()
  removeRadiusLayers()
  removeRadiusMarkers()
})

function closeRadius() {
  mapToolsStore.setActiveTool('none')
}
</script>

<template>
  <MeasureToolPanel
    v-if="isActive"
    :title="t('measure.circle')"
    :close-label="t('radius.close')"
    @close="closeRadius"
  >
    <template v-if="radiusCenter && radiusMeters > 0">
      <div class="flex flex-col gap-1.5">
        <MeasureReadout
          :label="t('radius.radius')"
          :value="radiusHint"
          :cycle-label="t('measure.cycleUnit')"
          @cycle="cycleDistance(radiusMeters)"
        />
        <MeasureReadout
          :label="t('radius.circumference')"
          :value="circumferenceHint"
          :cycle-label="t('measure.cycleUnit')"
          @cycle="cycleDistance(circumferenceMeters)"
        />
        <MeasureReadout
          v-if="areaHint"
          :label="t('measure.area')"
          :value="areaHint"
          :cycle-label="t('measure.cycleUnit')"
          @cycle="cycleArea(areaSquareMeters)"
        />
      </div>
      <UnitSystemToggle
        v-model="radiusUnitSystem"
        :metric-label="t('measure.unitsMetric')"
        :imperial-label="t('measure.unitsImperial')"
      />
    </template>
    <p v-else class="m-0 text-[13px] leading-[1.4] text-muted-foreground">
      {{ radiusCenter ? t('radius.clickToConfirm') : t('radius.empty') }}
    </p>
  </MeasureToolPanel>
</template>

