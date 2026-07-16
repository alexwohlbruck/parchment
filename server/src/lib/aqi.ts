/**
 * Multi-standard Air Quality Index (AQI) engine.
 *
 * OpenWeatherMap's Air Pollution API returns raw pollutant concentrations in
 * µg/m³ for anywhere on Earth. From those we compute whichever regional index
 * matches the location — the same way Apple/Google Maps show a local scale.
 *
 * The core correctness rule for every scale: the index is the MAXIMUM of the
 * per-pollutant sub-indices ("dominant pollutant" wins). A single-pollutant
 * (PM2.5-only) calculation badly under-reports on ozone-driven summer days.
 *
 * We return the standard's native `index` number plus a normalized `severity`
 * (1–6). The UI shows a single friendly word derived from severity — the same
 * six-step scale worldwide — so "how bad is it" reads consistently regardless
 * of which regional standard produced the number.
 *
 * Breakpoints are sourced from each agency's official tables:
 * - US EPA: aqs.epa.gov breakpoints (PM2.5 updated May 2024)
 * - EU: EEA European Air Quality Index bands (revised July 2025)
 * - UK: DEFRA Daily Air Quality Index
 * - China: GB 3095-2012 / HJ 633-2012 (IAQI)
 * - India: CPCB National Air Quality Index
 * - Canada: Environment Canada Air Quality Health Index (formula, not breakpoints)
 */

import type { AqiStandard, AqiPollutant, AirQuality } from '../types/integration.types'

export interface AqiComponents {
  co?: number
  no?: number
  no2?: number
  o3?: number
  so2?: number
  pm2_5?: number
  pm10?: number
  nh3?: number
}

// ---------------------------------------------------------------------------
// Unit conversion — OWM reports µg/m³; US EPA gas breakpoints use ppb/ppm.
// ppb = µg/m³ × 24.45 / MW   (24.45 L/mol at 25 °C, 1 atm)
// ---------------------------------------------------------------------------

const MOLAR_VOLUME = 24.45
const MW = { o3: 48.0, no2: 46.0055, so2: 64.066, co: 28.01 }

const ugToPpb = (ug: number, molecularWeight: number) =>
  (ug * MOLAR_VOLUME) / molecularWeight
const o3Ppm = (ug: number) => ugToPpb(ug, MW.o3) / 1000
const coPpm = (ug: number) => ugToPpb(ug, MW.co) / 1000
const so2Ppb = (ug: number) => ugToPpb(ug, MW.so2)
const no2Ppb = (ug: number) => ugToPpb(ug, MW.no2)

// ---------------------------------------------------------------------------
// Piecewise-linear breakpoint scales (US EPA, China, India)
// ---------------------------------------------------------------------------

interface Breakpoint {
  cLow: number
  cHigh: number
  iLow: number
  iHigh: number
  severity: number // normalized 1–6 (drives the color + friendly word)
}

interface PollutantScale {
  /** Convert the raw µg/m³ value into the unit the breakpoints use. */
  convert?: (ug: number) => number
  table: Breakpoint[]
}

/** Interpolate a concentration into its sub-index for one pollutant. */
function interpolate(
  concentration: number,
  scale: PollutantScale,
): { index: number; severity: number } | null {
  if (concentration == null || Number.isNaN(concentration) || concentration < 0)
    return null
  const c = scale.convert ? scale.convert(concentration) : concentration
  for (const bp of scale.table) {
    if (c <= bp.cHigh) {
      const clamped = Math.max(c, bp.cLow)
      const index = Math.round(
        ((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (clamped - bp.cLow) +
          bp.iLow,
      )
      return { index, severity: bp.severity }
    }
  }
  const top = scale.table[scale.table.length - 1]
  return { index: top.iHigh, severity: top.severity }
}

/** Max-of-sub-indices across all available pollutants for a breakpoint scale. */
function maxSubIndex(
  standard: AqiStandard,
  components: AqiComponents,
  scales: Partial<Record<AqiPollutant, PollutantScale>>,
): AirQuality | null {
  let best: AirQuality | null = null
  for (const key of Object.keys(scales) as AqiPollutant[]) {
    const raw = components[key]
    if (raw == null) continue
    const sub = interpolate(raw, scales[key]!)
    if (!sub) continue
    if (!best || sub.index > best.index) {
      best = {
        standard,
        index: sub.index,
        severity: sub.severity,
        dominant: key,
      }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// US EPA AQI (0–500). PM2.5 breakpoints per the May 2024 update.
// Six categories map directly to severity 1–6.
// ---------------------------------------------------------------------------

const usRow = (
  cLow: number,
  cHigh: number,
  iLow: number,
  iHigh: number,
  severity: number,
): Breakpoint => ({ cLow, cHigh, iLow, iHigh, severity })

const US_EPA: Partial<Record<AqiPollutant, PollutantScale>> = {
  // PM2.5 (24h, µg/m³) — updated May 2024 (Good ceiling 12→9)
  pm2_5: {
    table: [
      usRow(0.0, 9.0, 0, 50, 1),
      usRow(9.1, 35.4, 51, 100, 2),
      usRow(35.5, 55.4, 101, 150, 3),
      usRow(55.5, 125.4, 151, 200, 4),
      usRow(125.5, 225.4, 201, 300, 5),
      usRow(225.5, 325.4, 301, 500, 6),
    ],
  },
  // PM10 (24h, µg/m³)
  pm10: {
    table: [
      usRow(0, 54, 0, 50, 1),
      usRow(55, 154, 51, 100, 2),
      usRow(155, 254, 101, 150, 3),
      usRow(255, 354, 151, 200, 4),
      usRow(355, 424, 201, 300, 5),
      usRow(425, 604, 301, 500, 6),
    ],
  },
  // O3 (8h, ppm)
  o3: {
    convert: o3Ppm,
    table: [
      usRow(0.0, 0.054, 0, 50, 1),
      usRow(0.055, 0.07, 51, 100, 2),
      usRow(0.071, 0.085, 101, 150, 3),
      usRow(0.086, 0.105, 151, 200, 4),
      usRow(0.106, 0.2, 201, 300, 5),
      usRow(0.201, 0.604, 301, 500, 6),
    ],
  },
  // CO (8h, ppm)
  co: {
    convert: coPpm,
    table: [
      usRow(0.0, 4.4, 0, 50, 1),
      usRow(4.5, 9.4, 51, 100, 2),
      usRow(9.5, 12.4, 101, 150, 3),
      usRow(12.5, 15.4, 151, 200, 4),
      usRow(15.5, 30.4, 201, 300, 5),
      usRow(30.5, 50.4, 301, 500, 6),
    ],
  },
  // SO2 (1h, ppb; upper bands use the 24h figure per EPA)
  so2: {
    convert: so2Ppb,
    table: [
      usRow(0, 35, 0, 50, 1),
      usRow(36, 75, 51, 100, 2),
      usRow(76, 185, 101, 150, 3),
      usRow(186, 304, 151, 200, 4),
      usRow(305, 604, 201, 300, 5),
      usRow(605, 1004, 301, 500, 6),
    ],
  },
  // NO2 (1h, ppb)
  no2: {
    convert: no2Ppb,
    table: [
      usRow(0, 53, 0, 50, 1),
      usRow(54, 100, 51, 100, 2),
      usRow(101, 360, 101, 150, 3),
      usRow(361, 649, 151, 200, 4),
      usRow(650, 1249, 201, 300, 5),
      usRow(1250, 2049, 301, 500, 6),
    ],
  },
}

// ---------------------------------------------------------------------------
// China MEE / GB 3095-2012 (IAQI 0–500), concentrations in µg/m³ (CO in mg/m³).
// ---------------------------------------------------------------------------

// IAQI breakpoints are shared: 0,50,100,150,200,300,400,500 → severity 1..6
const cnScale = (
  cuts: number[],
  convert?: (ug: number) => number,
): PollutantScale => {
  const iaqi = [0, 50, 100, 150, 200, 300, 400, 500]
  const table: Breakpoint[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    table.push({
      cLow: cuts[i],
      cHigh: cuts[i + 1],
      iLow: iaqi[i],
      iHigh: iaqi[i + 1],
      severity: Math.min(i + 1, 6),
    })
  }
  return { convert, table }
}

const CN_MEE: Partial<Record<AqiPollutant, PollutantScale>> = {
  pm2_5: cnScale([0, 35, 75, 115, 150, 250, 350, 500]),
  pm10: cnScale([0, 50, 150, 250, 350, 420, 500, 600]),
  o3: cnScale([0, 160, 200, 300, 400, 800, 1000, 1200]), // 1h
  no2: cnScale([0, 100, 200, 700, 1200, 2340, 3090, 3840]), // 1h
  so2: cnScale([0, 150, 500, 650, 800, 1600, 2100, 2620]), // 1h→24h upper
  co: cnScale([0, 5, 10, 35, 60, 90, 120, 150], (ug) => ug / 1000), // 1h, mg/m³
}

// ---------------------------------------------------------------------------
// India CPCB NAQI (0–500), concentrations in µg/m³ (CO in mg/m³).
// ---------------------------------------------------------------------------

// NAQI index bands: 0-50,51-100,101-200,201-300,301-400,401-500 → severity 1..6
const inScale = (
  cuts: number[],
  convert?: (ug: number) => number,
): PollutantScale => {
  const iaqi = [0, 50, 100, 200, 300, 400, 500]
  const table: Breakpoint[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    table.push({
      cLow: cuts[i],
      cHigh: cuts[i + 1],
      iLow: iaqi[i],
      iHigh: iaqi[i + 1],
      severity: Math.min(i + 1, 6),
    })
  }
  return { convert, table }
}

const IN_NAQI: Partial<Record<AqiPollutant, PollutantScale>> = {
  pm2_5: inScale([0, 30, 60, 90, 120, 250, 380]), // 24h
  pm10: inScale([0, 50, 100, 250, 350, 430, 510]), // 24h
  o3: inScale([0, 50, 100, 168, 208, 748, 940]), // 8h
  no2: inScale([0, 40, 80, 180, 280, 400, 520]), // 24h
  so2: inScale([0, 40, 80, 380, 800, 1600, 2000]), // 24h
  co: inScale([0, 1, 2, 10, 17, 34, 50], (ug) => ug / 1000), // 8h, mg/m³
}

// ---------------------------------------------------------------------------
// EU — EEA European Air Quality Index (1–6 bands), µg/m³. Band = max over
// pollutants; no interpolated number. Uses the bands revised July 2025
// (aligned to WHO 2021 + Directive (EU) 2024/2881), 1-hour reference — the
// values the live EEA index now serves.
// ---------------------------------------------------------------------------

// Upper bounds of bands 1–5 (band 6 = anything above band-5 ceiling).
const EU_BANDS: Partial<Record<AqiPollutant, number[]>> = {
  pm2_5: [5, 15, 50, 90, 140],
  pm10: [15, 45, 120, 195, 270],
  no2: [10, 25, 60, 100, 150],
  o3: [60, 100, 120, 160, 180],
  so2: [20, 40, 125, 190, 275],
}

function euEea(components: AqiComponents): AirQuality | null {
  let bestBand = 0
  let dominant: AqiPollutant | null = null
  for (const key of Object.keys(EU_BANDS) as AqiPollutant[]) {
    const raw = components[key]
    if (raw == null) continue
    const bounds = EU_BANDS[key]!
    let band = bounds.findIndex((upper) => raw <= upper) // 0-based
    if (band === -1) band = 5 // above band-5 ceiling → Extremely poor
    if (band + 1 > bestBand) {
      bestBand = band + 1
      dominant = key
    }
  }
  if (!dominant) return null
  return { standard: 'eu_eea', index: bestBand, severity: bestBand, dominant }
}

// ---------------------------------------------------------------------------
// UK DEFRA DAQI (1–10), µg/m³. Index = max over pollutants.
// Bands: 1–3 Low, 4–6 Moderate, 7–9 High, 10 Very High → severity 1/3/4/6.
// ---------------------------------------------------------------------------

const UK_BANDS: Partial<Record<AqiPollutant, number[]>> = {
  // Upper bound of DAQI points 1–9 (point 10 = above the last bound).
  o3: [33, 66, 100, 120, 140, 160, 187, 213, 240], // 8h running mean
  no2: [67, 134, 200, 267, 334, 400, 467, 534, 600], // 1h
  so2: [88, 177, 266, 354, 443, 532, 710, 887, 1064], // 15min
  pm2_5: [11, 23, 35, 41, 47, 53, 58, 64, 70], // 24h
  pm10: [16, 33, 50, 58, 66, 75, 83, 91, 100], // 24h
}

function ukDaqiSeverity(point: number): number {
  if (point <= 3) return 1 // Low
  if (point <= 6) return 3 // Moderate
  if (point <= 9) return 4 // High
  return 6 // Very High
}

function ukDaqi(components: AqiComponents): AirQuality | null {
  let bestPoint = 0
  let dominant: AqiPollutant | null = null
  for (const key of Object.keys(UK_BANDS) as AqiPollutant[]) {
    const raw = components[key]
    if (raw == null) continue
    const bounds = UK_BANDS[key]!
    let point = bounds.findIndex((upper) => raw <= upper) + 1 // 1..9
    if (point === 0) point = 10
    if (point > bestPoint) {
      bestPoint = point
      dominant = key
    }
  }
  if (!dominant) return null
  return {
    standard: 'uk_daqi',
    index: bestPoint,
    severity: ukDaqiSeverity(bestPoint),
    dominant,
  }
}

// ---------------------------------------------------------------------------
// Canada AQHI (1–10+) — a formula, not breakpoints. O3/NO2 in ppb, PM2.5 µg/m³.
// AQHI = (1000/10.4) × [ (e^(0.000537·O3)−1) + (e^(0.000871·NO2)−1) + (e^(0.000487·PM2.5)−1) ]
// per Environment Canada (Stieb et al. 2008). Band: 1–3 Low, 4–6 Moderate,
// 7–10 High, >10 Very High → severity 1/3/4/6. OWM reports 1-hour
// concentrations; ECCC uses a 3-hour moving average, so this is a close
// instantaneous approximation.
// ---------------------------------------------------------------------------

function caAqhi(components: AqiComponents): AirQuality | null {
  const { o3, no2, pm2_5 } = components
  if (o3 == null && no2 == null && pm2_5 == null) return null
  const o3p = o3 != null ? o3Ppm(o3) * 1000 : 0 // ppb
  const no2p = no2 != null ? no2Ppb(no2) : 0 // ppb
  const pm = pm2_5 ?? 0

  const tO3 = Math.exp(0.000537 * o3p) - 1
  const tNo2 = Math.exp(0.000871 * no2p) - 1
  const tPm = Math.exp(0.000487 * pm) - 1
  const raw = (1000 / 10.4) * (tO3 + tNo2 + tPm)
  const index = Math.max(1, Math.round(raw))

  // Dominant term = largest contributor
  const terms: [AqiPollutant, number][] = [
    ['o3', tO3],
    ['no2', tNo2],
    ['pm2_5', tPm],
  ]
  const dominant = terms.reduce((a, b) => (b[1] > a[1] ? b : a))[0]

  let severity: number
  if (index <= 3) severity = 1 // Low
  else if (index <= 6) severity = 3 // Moderate
  else if (index <= 10) severity = 4 // High
  else severity = 6 // Very High

  return { standard: 'ca_aqhi', index, severity, dominant }
}

// ---------------------------------------------------------------------------
// Country → standard mapping. Auto-detect by the viewed location's country.
// ---------------------------------------------------------------------------

// EU-27 + EFTA/EEA + Switzerland + European-AQI cooperating countries use the
// EAQI. GR and EL are both accepted for Greece (ISO vs EU variant).
const EEA_COUNTRIES = new Set([
  // EU-27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'EL',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EFTA / EEA + Switzerland
  'IS', 'LI', 'NO', 'CH',
  // Cooperating countries shown on the European AQI
  'AL', 'BA', 'ME', 'MK', 'RS', 'TR', 'AD', 'XK',
])
// US EPA AQI also governs US territories.
const US_COUNTRIES = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP'])

export function standardForCountry(country?: string | null): AqiStandard {
  const c = country?.toUpperCase()
  if (!c) return 'us_epa' // global fallback
  if (US_COUNTRIES.has(c)) return 'us_epa'
  if (c === 'GB') return 'uk_daqi'
  if (c === 'CA') return 'ca_aqhi'
  if (c === 'IN') return 'in_naqi'
  if (c === 'CN') return 'cn_mee'
  if (EEA_COUNTRIES.has(c)) return 'eu_eea'
  return 'us_epa' // global fallback (matches IQAir/PurpleAir convention)
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Compute the air-quality index for a location using its regional standard.
 * @param components Raw pollutant concentrations from OpenWeatherMap (µg/m³).
 * @param country ISO 3166-1 alpha-2 code of the location (OWM `sys.country`).
 */
export function computeAirQuality(
  components: AqiComponents | undefined,
  country?: string | null,
): AirQuality | null {
  if (!components) return null
  const standard = standardForCountry(country)
  switch (standard) {
    case 'us_epa':
      return maxSubIndex('us_epa', components, US_EPA)
    case 'cn_mee':
      return maxSubIndex('cn_mee', components, CN_MEE)
    case 'in_naqi':
      return maxSubIndex('in_naqi', components, IN_NAQI)
    case 'eu_eea':
      return euEea(components)
    case 'uk_daqi':
      return ukDaqi(components)
    case 'ca_aqhi':
      return caAqhi(components)
  }
}
