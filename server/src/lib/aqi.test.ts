/**
 * Tests for the multi-standard AQI engine.
 *
 * Anchors are agency-defined boundary values (stable) plus the real-world
 * regression that motivated this work: on an ozone-driven day, a PM2.5-only
 * calculation reports "Moderate" while the correct max-of-pollutants index is
 * "Unhealthy" — the 57-vs-155 gap against Apple Maps.
 */

import { describe, test, expect } from 'bun:test'
import { computeAirQuality, standardForCountry } from './aqi'

describe('standardForCountry', () => {
  test('maps countries to their official standard', () => {
    expect(standardForCountry('US')).toBe('us_epa')
    expect(standardForCountry('us')).toBe('us_epa') // case-insensitive
    expect(standardForCountry('GB')).toBe('uk_daqi')
    expect(standardForCountry('CA')).toBe('ca_aqhi')
    expect(standardForCountry('IN')).toBe('in_naqi')
    expect(standardForCountry('CN')).toBe('cn_mee')
    expect(standardForCountry('FR')).toBe('eu_eea')
    expect(standardForCountry('DE')).toBe('eu_eea')
    expect(standardForCountry('EL')).toBe('eu_eea') // Greece EU variant
  })

  test('falls back to US EPA for unknown / missing country', () => {
    expect(standardForCountry('ZZ')).toBe('us_epa')
    expect(standardForCountry(undefined)).toBe('us_epa')
    expect(standardForCountry(null)).toBe('us_epa')
  })
})

describe('US EPA AQI', () => {
  test('PM2.5 boundary anchors (2024 breakpoints)', () => {
    // Good/Moderate boundary is 9.0 µg/m³ post-May-2024 (was 12.0)
    expect(computeAirQuality({ pm2_5: 9.0 }, 'US')?.index).toBe(50)
    expect(computeAirQuality({ pm2_5: 35.4 }, 'US')?.index).toBe(100)
    expect(computeAirQuality({ pm2_5: 55.4 }, 'US')?.index).toBe(150)
  })

  test('THE REGRESSION: ozone-driven day is Unhealthy, not Moderate', () => {
    // Moderate PM2.5 alone → ~71 (Moderate, severity 2). The old (wrong) answer.
    const pmOnly = computeAirQuality({ pm2_5: 20 }, 'US')
    expect(pmOnly?.index).toBe(71)
    expect(pmOnly?.dominant).toBe('pm2_5')
    expect(pmOnly?.severity).toBe(2)

    // Same day with high ozone → the ozone sub-index dominates → Unhealthy.
    const full = computeAirQuality({ pm2_5: 20, o3: 175 }, 'US')
    expect(full?.index).toBe(159)
    expect(full?.dominant).toBe('o3')
    expect(full?.severity).toBe(4) // → "Poor" on the friendly scale
  })

  test('gas concentrations are converted µg/m³ → ppb/ppm before lookup', () => {
    // NO2 54 ppb is the 50/51 boundary; 54 ppb ≈ 101.6 µg/m³
    const r = computeAirQuality({ no2: 101.6 }, 'US')
    expect(r?.index).toBeGreaterThanOrEqual(50)
    expect(r?.index).toBeLessThanOrEqual(52)
  })
})

describe('EU — European Air Quality Index (revised 2025 bands)', () => {
  test('PM2.5 lands in the Moderate band', () => {
    // Revised PM2.5: Good 0–5, Fair 6–15, Moderate 16–50 → 30 is Moderate (band 3)
    const r = computeAirQuality({ pm2_5: 30 }, 'FR')
    expect(r?.standard).toBe('eu_eea')
    expect(r?.index).toBe(3)
    expect(r?.severity).toBe(3)
  })

  test('worst pollutant sets the band', () => {
    // pm2_5=3 (Good) but no2=120 (>150? no; 101–150 Very poor=band5) → band 5
    const r = computeAirQuality({ pm2_5: 3, no2: 120 }, 'DE')
    expect(r?.index).toBe(5)
    expect(r?.dominant).toBe('no2')
  })
})

describe('UK DAQI', () => {
  test('PM2.5 40 µg/m³ → index 4 (Moderate band)', () => {
    const r = computeAirQuality({ pm2_5: 40 }, 'GB')
    expect(r?.standard).toBe('uk_daqi')
    expect(r?.index).toBe(4)
    expect(r?.severity).toBe(3) // Moderate band
  })
})

describe('China MEE AQI', () => {
  test('PM2.5 75 µg/m³ is the 100 IAQI boundary', () => {
    const r = computeAirQuality({ pm2_5: 75 }, 'CN')
    expect(r?.standard).toBe('cn_mee')
    expect(r?.index).toBe(100)
  })
})

describe('India CPCB NAQI', () => {
  test('PM2.5 90 µg/m³ is the 200 boundary (Moderate)', () => {
    const r = computeAirQuality({ pm2_5: 90 }, 'IN')
    expect(r?.standard).toBe('in_naqi')
    expect(r?.index).toBe(200)
    expect(r?.severity).toBe(3) // Moderate
  })
})

describe('Canada AQHI', () => {
  test('clean air → Low health risk', () => {
    const r = computeAirQuality({ o3: 40, no2: 10, pm2_5: 5 }, 'CA')
    expect(r?.standard).toBe('ca_aqhi')
    expect(r?.index).toBe(2)
    expect(r?.severity).toBe(1) // Low → "Good"
  })

  test('moderate mix → Moderate health risk', () => {
    const r = computeAirQuality({ o3: 120, no2: 40, pm2_5: 20 }, 'CA')
    expect(r?.index).toBe(6)
    expect(r?.severity).toBe(3) // Moderate
  })
})

describe('edge cases', () => {
  test('no components → null', () => {
    expect(computeAirQuality(undefined, 'US')).toBeNull()
    expect(computeAirQuality({}, 'US')).toBeNull()
  })

  test('ignores nullish pollutant values', () => {
    const r = computeAirQuality({ pm2_5: 20, o3: undefined }, 'US')
    expect(r?.dominant).toBe('pm2_5')
  })
})
