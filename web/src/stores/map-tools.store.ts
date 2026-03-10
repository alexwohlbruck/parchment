import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { LngLat } from '@/types/map.types'
import {
  MEASURE_SOURCE_ID,
  MEASURE_LAYER_ID,
  MEASURE_POINTS_LAYER_ID,
} from '@/constants/layer.constants'

export type MapToolId = 'none' | 'measure' | 'radius'

export const useMapToolsStore = defineStore('map-tools', () => {
  const activeTool = ref<MapToolId>('none')

  // Measure tool state: points in order, and history for undo/redo
  const measurePoints = ref<LngLat[]>([])

  // Radius tool state: center, edge point (where user set radius), radius in meters, and whether user confirmed
  const radiusCenter = ref<LngLat | null>(null)
  const radiusEdgePoint = ref<LngLat | null>(null)
  const radiusMeters = ref(0)
  const radiusConfirmed = ref(false)
  const measureHistory = ref<LngLat[][]>([])
  const measureHistoryIndex = ref(-1)

  const canUndo = computed(() => measureHistoryIndex.value > 0)
  const canRedo = computed(
    () => measureHistoryIndex.value < measureHistory.value.length - 1,
  )

  const isMeasureClosed = computed(() => {
    const points = measurePoints.value
    if (points.length < 3) return false
    const first = points[0]
    const last = points[points.length - 1]
    const tol = 1e-9
    return (
      Math.abs(first.lng - last.lng) < tol && Math.abs(first.lat - last.lat) < tol
    )
  })

  function setActiveTool(tool: MapToolId) {
    activeTool.value = tool
    if (tool !== 'measure') {
      clearMeasure()
    }
    if (tool !== 'radius') {
      clearRadius()
    }
  }

  function setRadiusCenter(center: LngLat | null) {
    radiusCenter.value = center
    if (!center) {
      radiusEdgePoint.value = null
      radiusMeters.value = 0
      radiusConfirmed.value = false
    }
  }

  function setRadiusEdgePoint(point: LngLat | null) {
    radiusEdgePoint.value = point
  }

  function setRadiusMeters(meters: number) {
    radiusMeters.value = meters
  }

  function confirmRadius() {
    radiusConfirmed.value = true
  }

  function clearRadius() {
    radiusCenter.value = null
    radiusEdgePoint.value = null
    radiusMeters.value = 0
    radiusConfirmed.value = false
  }

  function clearMeasure() {
    measurePoints.value = []
    measureHistory.value = []
    measureHistoryIndex.value = -1
  }

  function pushMeasureState(points: LngLat[]) {
    const next = [...points]
    const history = measureHistory.value
    const idx = measureHistoryIndex.value
    if (history.length === 0 && idx === -1) {
      measureHistory.value = [[], next]
      measureHistoryIndex.value = 1
      measurePoints.value = next
      return
    }
    measureHistory.value = history.slice(0, idx + 1).concat([next])
    measureHistoryIndex.value = measureHistory.value.length - 1
    measurePoints.value = next
  }

  function setMeasurePoints(points: LngLat[]) {
    measurePoints.value = [...points]
  }

  function measureUndo() {
    const history = measureHistory.value
    const idx = measureHistoryIndex.value
    if (idx <= 0) return
    const prev = history[idx - 1]
    measureHistoryIndex.value = idx - 1
    measurePoints.value = [...prev]
  }

  function measureRedo() {
    const history = measureHistory.value
    const idx = measureHistoryIndex.value
    if (idx >= history.length - 1) return
    const next = history[idx + 1]
    measureHistoryIndex.value = idx + 1
    measurePoints.value = [...next]
  }

  return {
    activeTool,
    measurePoints,
    measureHistory,
    measureHistoryIndex,
    canUndo,
    canRedo,
    isMeasureClosed,
    radiusCenter,
    radiusEdgePoint,
    radiusMeters,
    radiusConfirmed,
    setActiveTool,
    clearMeasure,
    pushMeasureState,
    setMeasurePoints,
    measureUndo,
    measureRedo,
    setRadiusCenter,
    setRadiusEdgePoint,
    setRadiusMeters,
    confirmRadius,
    clearRadius,
    MEASURE_SOURCE_ID,
    MEASURE_LAYER_ID,
    MEASURE_POINTS_LAYER_ID,
  }
})
