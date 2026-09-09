/**
 * Tests for the OpenAQ pure transforms (unit normalization + station
 * assembly). Network paths are gated on the OpenAQ integration key and not
 * exercised here.
 */

import { describe, test, expect } from 'bun:test'
import {
  toMicrogramsPerM3,
  assembleStation,
  type OpenAqLocation,
} from './air-quality.service'

describe('toMicrogramsPerM3', () => {
  test('passes particulates through unchanged', () => {
    expect(toMicrogramsPerM3('pm2_5', 100, 'µg/m³')).toBe(100)
    expect(toMicrogramsPerM3('pm10', 42, 'ug/m3')).toBe(42)
    expect(toMicrogramsPerM3('pm2_5', 20, '')).toBe(20)
  })

  test('converts gas ppb → µg/m³', () => {
    // O3: 50 ppb × 48 / 24.45 ≈ 98.2
    expect(toMicrogramsPerM3('o3', 50, 'ppb')).toBeCloseTo(98.16, 1)
    // NO2: 26.6 ppb × 46.0055 / 24.45 ≈ 50.05
    expect(toMicrogramsPerM3('no2', 26.6, 'ppb')).toBeCloseTo(50.05, 1)
  })

  test('converts CO ppm → µg/m³', () => {
    // 5 ppm × 1000 × 28.01 / 24.45 ≈ 5728
    expect(toMicrogramsPerM3('co', 5, 'ppm')).toBeCloseTo(5728, 0)
  })
})

describe('assembleStation', () => {
  const loc: OpenAqLocation = {
    id: 1,
    name: 'Test Station',
    country: { code: 'US' },
    coordinates: { latitude: 40.7, longitude: -74 },
    sensors: [
      { id: 101, parameter: { name: 'pm25', units: 'µg/m³' } },
      { id: 102, parameter: { name: 'o3', units: 'ppb' } },
      { id: 103, parameter: { name: 'nox', units: 'ppb' } }, // unknown → skipped
    ],
  }

  test('joins sensors→latest, normalizes units, computes regional AQI', () => {
    const station = assembleStation(loc, [
      { sensorsId: 101, value: 100, datetime: { utc: '2026-07-16T01:00:00Z' } },
      { sensorsId: 102, value: 20, datetime: { utc: '2026-07-16T01:00:00Z' } },
    ])
    expect(station).not.toBeNull()
    expect(station!.components.pm2_5).toBe(100)
    expect(station!.components.o3).toBeCloseTo((20 * 48) / 24.45, 1) // ppb→µg/m³
    expect(station!.components).not.toHaveProperty('nox')
    // PM2.5 100 µg/m³ dominates → US AQI 182 (the OpenAQ-vs-model fix)
    expect(station!.airQuality?.standard).toBe('us_epa')
    expect(station!.airQuality?.index).toBe(182)
    expect(station!.airQuality?.dominant).toBe('pm2_5')
    expect(station!.updatedAt).toBe('2026-07-16T01:00:00Z')
  })

  test('returns null without coordinates', () => {
    expect(assembleStation({ id: 2, sensors: [] }, [])).toBeNull()
  })

  test('returns null when no usable measurements', () => {
    expect(assembleStation(loc, [])).toBeNull() // no latest values
    expect(
      assembleStation(loc, [{ sensorsId: 999, value: 5 }]), // no matching sensor
    ).toBeNull()
  })
})
