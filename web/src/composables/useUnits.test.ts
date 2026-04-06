/**
 * Unit tests for useUnits composable
 *
 * Tests cover:
 * - formatDistance (meters -> km/mi, m/ft)
 * - formatSpeed (m/s -> km/h or mph)
 * - formatTemperature (Celsius -> °C or °F)
 * - formatElevation (meters -> m or ft)
 * - formatPressure (hPa -> hPa or inHg)
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { UnitSystem } from '@/types/map.types'

const mockUnitSystem = ref<UnitSystem>(UnitSystem.METRIC)

vi.mock('@/stores/preferences.store', () => ({
  usePreferencesStore: () => ({
    unitSystem: mockUnitSystem,
  }),
}))

// Must import after mocks
import { useUnits } from './useUnits'

describe('useUnits', () => {
  beforeEach(() => {
    mockUnitSystem.value = UnitSystem.METRIC
  })

  describe('formatDistance', () => {
    test('metric: meters < 1000 shows m', () => {
      const { formatDistance } = useUnits()
      expect(formatDistance(500)).toBe('500 m')
      expect(formatDistance(0)).toBe('0 m')
    })
    test('metric: meters >= 1000 shows km', () => {
      const { formatDistance } = useUnits()
      expect(formatDistance(1000)).toMatch(/^1\.0 km$/)
      expect(formatDistance(8400)).toMatch(/^8\.4 km$/)
    })
    test('imperial: small distance shows ft', () => {
      mockUnitSystem.value = UnitSystem.IMPERIAL
      const { formatDistance } = useUnits()
      expect(formatDistance(100)).toMatch(/\d+ ft/)
    })
    test('imperial: larger distance shows mi', () => {
      mockUnitSystem.value = UnitSystem.IMPERIAL
      const { formatDistance } = useUnits()
      expect(formatDistance(1609)).toMatch(/\d+\.\d+ mi/)
    })
  })

  describe('formatSpeed', () => {
    test('metric: m/s to km/h', () => {
      const { formatSpeed } = useUnits()
      // 10 m/s = 36 km/h
      expect(formatSpeed(10)).toBe('36 km/h')
    })
    test('imperial: m/s to mph', () => {
      mockUnitSystem.value = UnitSystem.IMPERIAL
      const { formatSpeed } = useUnits()
      expect(formatSpeed(10)).toMatch(/\d+ mph/)
    })
  })

  describe('formatTemperature', () => {
    test('metric: shows °C', () => {
      const { formatTemperature } = useUnits()
      expect(formatTemperature(22)).toBe('22°C')
    })
    test('imperial: Celsius to °F', () => {
      mockUnitSystem.value = UnitSystem.IMPERIAL
      const { formatTemperature } = useUnits()
      expect(formatTemperature(0)).toBe('32°F')
      expect(formatTemperature(22)).toBe('72°F')
    })
  })

  describe('formatElevation', () => {
    test('metric: shows m', () => {
      const { formatElevation } = useUnits()
      expect(formatElevation(100)).toBe('100 m')
    })
    test('imperial: meters to ft', () => {
      mockUnitSystem.value = UnitSystem.IMPERIAL
      const { formatElevation } = useUnits()
      expect(formatElevation(100)).toMatch(/\d+ ft/)
    })
  })

  describe('formatPressure', () => {
    test('metric: shows hPa', () => {
      const { formatPressure } = useUnits()
      expect(formatPressure(1013)).toBe('1013 hPa')
    })
    test('imperial: hPa to inHg', () => {
      mockUnitSystem.value = UnitSystem.IMPERIAL
      const { formatPressure } = useUnits()
      expect(formatPressure(1013)).toMatch(/\d+\.\d+ inHg/)
    })
  })
})
