/**
 * Unit tests for map-tools store (Distance/polygon and Circle measure tools).
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMapToolsStore } from './map-tools.store'
import type { LngLat } from '@/types/map.types'

const p1: LngLat = { lng: -122.4194, lat: 37.7749 }
const p2: LngLat = { lng: -122.4094, lat: 37.7849 }
const p3: LngLat = { lng: -122.4294, lat: 37.7849 }

describe('useMapToolsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('setActiveTool', () => {
    test('clears measure state when switching away from measure', () => {
      const store = useMapToolsStore()
      store.setActiveTool('measure')
      store.setMeasurePoints([p1, p2])
      store.setActiveTool('radius')
      expect(store.measurePoints).toEqual([])
    })

    test('clears radius state when switching away from radius', () => {
      const store = useMapToolsStore()
      store.setActiveTool('radius')
      store.setRadiusCenter(p1)
      store.setRadiusEdgePoint(p2)
      store.setRadiusMeters(1000)
      store.setActiveTool('measure')
      expect(store.radiusCenter).toBeNull()
      expect(store.radiusEdgePoint).toBeNull()
      expect(store.radiusMeters).toBe(0)
      expect(store.radiusConfirmed).toBe(false)
    })
  })

  describe('Polygon measure', () => {
    test('undo/redo restores previous point states', () => {
      const store = useMapToolsStore()
      store.pushMeasureState([p1])
      store.pushMeasureState([p1, p2])
      store.pushMeasureState([p1, p2, p3])
      store.measureUndo()
      expect(store.measurePoints).toEqual([p1, p2])
      store.measureUndo()
      expect(store.measurePoints).toEqual([p1])
      store.measureRedo()
      expect(store.measurePoints).toEqual([p1, p2])
      store.measureRedo()
      expect(store.measurePoints).toEqual([p1, p2, p3])
    })

    test('isMeasureClosed is true only when first and last point are same', () => {
      const store = useMapToolsStore()
      store.setMeasurePoints([p1, p2, p3])
      expect(store.isMeasureClosed).toBe(false)
      store.setMeasurePoints([p1, p2, p3, { ...p1 }])
      expect(store.isMeasureClosed).toBe(true)
    })

    test('clearMeasure resets points and history', () => {
      const store = useMapToolsStore()
      store.pushMeasureState([p1, p2, p3])
      store.clearMeasure()
      expect(store.measurePoints).toEqual([])
      expect(store.canUndo).toBe(false)
      expect(store.canRedo).toBe(false)
    })
  })

  describe('Circle measure', () => {
    test('setRadiusCenter(null) clears edge, radius, and confirmed', () => {
      const store = useMapToolsStore()
      store.setRadiusCenter(p1)
      store.setRadiusEdgePoint(p2)
      store.setRadiusMeters(1000)
      store.setRadiusCenter(null)
      expect(store.radiusCenter).toBeNull()
      expect(store.radiusEdgePoint).toBeNull()
      expect(store.radiusMeters).toBe(0)
      expect(store.radiusConfirmed).toBe(false)
    })

    test('setRadiusCenter(new) does not clear edge point', () => {
      const store = useMapToolsStore()
      store.setRadiusCenter(p1)
      store.setRadiusEdgePoint(p2)
      store.setRadiusCenter(p3)
      expect(store.radiusCenter).toEqual(p3)
      expect(store.radiusEdgePoint).toEqual(p2)
    })

    test('clearRadius resets all radius state', () => {
      const store = useMapToolsStore()
      store.setRadiusCenter(p1)
      store.setRadiusEdgePoint(p2)
      store.setRadiusMeters(1000)
      store.confirmRadius()
      store.clearRadius()
      expect(store.radiusCenter).toBeNull()
      expect(store.radiusEdgePoint).toBeNull()
      expect(store.radiusMeters).toBe(0)
      expect(store.radiusConfirmed).toBe(false)
    })
  })
})
