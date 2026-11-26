/**
 * The plants' year: the colour every leafy role takes on each day, and how much of
 * its leaf it carries.
 *
 * Each role is a ramp of keyframes through a northern year, resampled to `RAMP`
 * evenly spaced steps the shader blends between. Each step holds `STOPS` colours, and
 * a plant's tint sets where it falls between them, so a stand in fall runs from late
 * green through yellow, gold, orange and red to dusty brown. Every plant reads the ramp a few
 * days early or late (see `phaseOf`), so a street turns tree by tree rather than all
 * at once. Where a deciduous tree carries less than a full crown its bare branches
 * are drawn under it, and the crown thins to show them.
 */
import type { FlavorId } from '@/lib/map-style/build'
import { TREE_FAMILIES } from './trees'
import { CROWN_SUFFIX } from './forest'

/** Steps a ramp is resampled to, the columns of the shader's `u_ramps`. */
export const RAMP = 48

/** How far either side of the date a plant's own season may run, as a share of the year. */
export const PHASE_SPREAD = 13 / 365

/** Latitudes nearer the equator than this stay in high summer all year. */
const EVERGREEN_LATITUDE = 27
/** High summer, where plants that do not follow the seasons stay. */
export const MIDSUMMER = 182 / 365

/** Days since January 1st, in the date's own calendar. */
export function dayOfYear(date: Date): number {
  return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / 86_400_000)
}

/** Where the plants' year stands on a day, 0-1 from January 1st in the north, a half-year on in the south. */
export function yearAt(day: number, lat: number): number {
  if (Math.abs(lat) < EVERGREEN_LATITUDE) return MIDSUMMER
  return (day / 365 + (lat < 0 ? 0.5 : 0)) % 1
}

/** A plant's own offset into the season, from the hashes it already carries; mirrored in the shader. */
export function phaseOf(tint: number, shade: number): number {
  const x = tint * 7.13 + shade * 13.7
  return x - Math.floor(x)
}

type Rgb = [number, number, number]
/** Day of a northern year, the colours a stand spreads across, and the share of leaf on. */
type Key = [day: number, colors: Rgb[], leaf: number]

/** Colours each step spreads its plants across; a key with fewer is stretched to fit. */
export const STOPS = 6

const DORMANT: Rgb = [0.62, 0.5, 0.38]

const KEYS: Record<string, Key[]> = {
  // Broadleaves: bare until April, chartreuse at budburst, lime in May, deep through summer.
  // In fall a stand runs from holdouts still green through yellow, gold, orange and red to
  // dusty brown, and goes brown as the leaves come down into December.
  foliage: [
    [80, [[0.74, 0.84, 0.42], [0.7, 0.8, 0.44]], 0],
    [100, [[0.8, 0.92, 0.45], [0.72, 0.9, 0.5]], 0.45],
    [125, [[0.74, 0.9, 0.44], [0.64, 0.86, 0.5]], 1],
    [165, [[0.62, 0.81, 0.47], [0.52, 0.75, 0.5]], 1],
    [230, [[0.58, 0.76, 0.44], [0.5, 0.7, 0.46]], 1],
    [268, [[0.54, 0.73, 0.44], [0.68, 0.79, 0.4], [0.78, 0.78, 0.36], [0.8, 0.66, 0.3], [0.72, 0.44, 0.26], [0.62, 0.6, 0.42]], 1],
    [298, [[0.5, 0.68, 0.38], [0.98, 0.84, 0.3], [0.97, 0.66, 0.2], [0.92, 0.45, 0.17], [0.8, 0.21, 0.15], [0.66, 0.53, 0.4]], 1],
    [315, [[0.62, 0.7, 0.36], [0.95, 0.78, 0.3], [0.92, 0.58, 0.22], [0.86, 0.4, 0.18], [0.7, 0.2, 0.16], [0.62, 0.5, 0.38]], 1],
    [330, [[0.72, 0.68, 0.36], [0.88, 0.7, 0.32], [0.84, 0.52, 0.24], [0.76, 0.38, 0.2], [0.6, 0.24, 0.18], [0.58, 0.47, 0.36]], 0.75],
    [345, [[0.66, 0.56, 0.36], [0.74, 0.58, 0.32], [0.7, 0.5, 0.3], [0.64, 0.4, 0.26], [0.56, 0.32, 0.24], [0.56, 0.46, 0.36]], 0.35],
    [356, [DORMANT], 0],
  ],
  // Flowering cherries: pink on bare wood in late March, petals giving way to leaf in
  // late April, green through summer, then bronze, orange and red before they drop.
  blossom: [
    [78, [[0.98, 0.74, 0.84], [0.99, 0.9, 0.93]], 0],
    [88, [[0.98, 0.74, 0.84], [0.99, 0.9, 0.93]], 0.8],
    [104, [[0.98, 0.76, 0.86], [0.99, 0.9, 0.93]], 1],
    [116, [[0.84, 0.86, 0.6], [0.9, 0.84, 0.78]], 1],
    [132, [[0.66, 0.86, 0.47], [0.58, 0.82, 0.5]], 1],
    [170, [[0.58, 0.78, 0.46], [0.5, 0.73, 0.48]], 1],
    [268, [[0.62, 0.76, 0.42], [0.56, 0.7, 0.42]], 1],
    [295, [[0.6, 0.66, 0.34], [0.95, 0.74, 0.3], [0.93, 0.56, 0.24], [0.88, 0.42, 0.2], [0.76, 0.24, 0.2], [0.62, 0.48, 0.36]], 1],
    [318, [[0.72, 0.6, 0.32], [0.88, 0.62, 0.28], [0.86, 0.48, 0.24], [0.8, 0.38, 0.22], [0.68, 0.26, 0.2], [0.58, 0.46, 0.34]], 0.75],
    [335, [[0.74, 0.52, 0.3], [0.62, 0.34, 0.24], [0.56, 0.45, 0.34]], 0.3],
    [348, [[0.7, 0.45, 0.3], [0.6, 0.36, 0.26]], 0],
  ],
  // Evergreens only deepen in winter and brighten with new growth.
  needles: [
    [15, [[0.4, 0.56, 0.42], [0.35, 0.5, 0.43]], 1],
    [130, [[0.54, 0.75, 0.47], [0.47, 0.69, 0.49]], 1],
    [190, [[0.5, 0.7, 0.46], [0.43, 0.64, 0.48]], 1],
    [290, [[0.47, 0.65, 0.45], [0.41, 0.6, 0.46]], 1],
    [345, [[0.41, 0.57, 0.42], [0.36, 0.51, 0.43]], 1],
  ],
  frond: [
    [0, [[0.66, 0.83, 0.5], [0.55, 0.77, 0.52]], 1],
  ],
  // Hedges and shrubs keep their leaf, dull olive in winter and russet in fall.
  shrub: [
    [15, [[0.52, 0.6, 0.42], [0.6, 0.52, 0.42]], 1],
    [115, [[0.7, 0.88, 0.46], [0.62, 0.84, 0.5]], 1],
    [190, [[0.62, 0.8, 0.48], [0.54, 0.75, 0.5]], 1],
    [262, [[0.62, 0.76, 0.44], [0.62, 0.62, 0.38]], 1],
    [293, [[0.6, 0.68, 0.4], [0.8, 0.62, 0.3], [0.78, 0.42, 0.26], [0.62, 0.5, 0.38]], 1],
    [335, [[0.54, 0.6, 0.42], [0.6, 0.52, 0.42]], 1],
  ],
  // Bedding: daffodils, then tulips, summer annuals, mums in fall, nothing in winter.
  bloom: [
    [60, [DORMANT], 0],
    [80, [[0.99, 0.86, 0.34], [0.99, 0.94, 0.7]], 0.5],
    [110, [[0.96, 0.46, 0.58], [0.99, 0.86, 0.34]], 1],
    [180, [[0.9, 0.52, 0.68], [0.96, 0.82, 0.36]], 1],
    [245, [[0.84, 0.4, 0.62], [0.95, 0.7, 0.3]], 1],
    [283, [[0.94, 0.62, 0.22], [0.64, 0.22, 0.3]], 1],
    [318, [[0.7, 0.45, 0.3], [0.6, 0.36, 0.26]], 0.4],
    [340, [DORMANT], 0],
  ],
  // A distant bare crown's fine twigs: a pale veil, mostly sky.
  twigs: [
    [0, [[0.66, 0.6, 0.58], [0.6, 0.55, 0.54]], 0.45],
  ],
}

/**
 * A role's year, resampled: `STOPS` rows of `RAMP` steps, each rgb and the share of leaf on.
 * Laid out as the rows of the texture the shader reads.
 */
export type SeasonRamp = Float32Array

const lerpRgb = (x: Rgb, y: Rgb, t: number) => x.map((c, i) => c + (y[i] - c) * t) as Rgb

/** A key's colours stretched evenly across `STOPS`. */
function spread(colors: Rgb[]): Rgb[] {
  return Array.from({ length: STOPS }, (_, s) => {
    const at = (s / (STOPS - 1)) * (colors.length - 1)
    const k = Math.min(Math.floor(at), colors.length - 2)
    return k < 0 ? colors[0] : lerpRgb(colors[k], colors[k + 1], at - k)
  })
}

/** Night colours from day ones: darker, deeper, and a little greyer, as the night palette is. */
function night([r, g, b]: Rgb): Rgb {
  const deep = [r, g, b].map(c => c ** 2.2 * 0.48)
  const grey = (deep[0] + deep[1] + deep[2]) / 3
  return deep.map(c => c * 0.8 + grey * 0.2) as Rgb
}

function sample(keys: Key[], day: number): { colors: Rgb[]; leaf: number } {
  const next = keys.findIndex(k => k[0] > day)
  const b = keys[next === -1 ? 0 : next]
  const a = keys[next <= 0 ? keys.length - 1 : next - 1]
  const span = (b[0] - a[0] + 365) % 365 || 365
  const t = ((day - a[0] + 365) % 365) / span
  const [from, to] = [spread(a[1]), spread(b[1])]
  return { colors: from.map((c, s) => lerpRgb(c, to[s], t)), leaf: a[2] + (b[2] - a[2]) * t }
}

function resample(keys: Key[], flavor: FlavorId, held?: number): SeasonRamp {
  const ramp = new Float32Array(STOPS * RAMP * 4)
  for (let i = 0; i < RAMP; i++) {
    const at = sample(keys, held ?? (i / RAMP) * 365)
    at.colors.forEach((c, s) => ramp.set([...(flavor === 'dark' ? night(c) : c), at.leaf], (s * RAMP + i) * 4))
  }
  return ramp
}

/** With seasons off, the day each role is held at: cherries in full bloom, everything else in high summer. */
const SIGNATURE_DAY: Record<string, number> = { blossom: 104 }

function ramps(flavor: FlavorId, seasonal: boolean): Record<string, SeasonRamp> {
  return Object.fromEntries(
    Object.entries(KEYS).map(([role, keys]) => [role, resample(keys, flavor, seasonal ? undefined : (SIGNATURE_DAY[role] ?? MIDSUMMER * 365))]),
  )
}

const RAMPS = {
  seasonal: { light: ramps('light', true), dark: ramps('dark', true) },
  held: { light: ramps('light', false), dark: ramps('dark', false) },
}

/** Every leafy role's year, for a flavor; with seasons off, each role holds its signature look all year. */
export function seasonRamps(flavor: FlavorId, seasonal = true): Record<string, SeasonRamp> {
  return RAMPS[seasonal ? 'seasonal' : 'held'][flavor]
}

/** A plant's colour and leaf at a point in the year, `tint` 0-1 along the stops; the shader's lookup, for the CPU. */
export function rampAt(ramp: SeasonRamp, year: number, tint = 0): { color: Rgb; leaf: number } {
  const at = (((year % 1) + 1) % 1) * RAMP
  const i = Math.floor(at) % RAMP
  const j = (i + 1) % RAMP
  const t = at - Math.floor(at)
  const x = tint * (STOPS - 1)
  const k = Math.min(Math.floor(x), STOPS - 2)
  const f = x - k
  const texel = (stop: number, step: number, c: number) => ramp[(stop * RAMP + step) * 4 + c]
  const value = (c: number) => {
    const step = (n: number) => texel(k, n, c) + (texel(k + 1, n, c) - texel(k, n, c)) * f
    return step(i) + (step(j) - step(i)) * t
  }
  return { color: [value(0), value(1), value(2)], leaf: value(3) }
}

/** A plant's own point in the year. */
export function plantYear(year: number, phase: number): number {
  return year + (phase - 0.5) * 2 * PHASE_SPREAD
}

/** Suffix on a deciduous tree's winter model; see `bareTree` in `build-3d-objects.mjs`. */
export const BARE_SUFFIX = '-bare'

/** A deciduous model's bare branches, and the role whose leaf decides whether they show. */
export type Deciduous = { bare: string; role: string }

/** Every deciduous model, crown-only or whole, by name. */
export const DECIDUOUS: Record<string, Deciduous> = Object.fromEntries(
  [
    ...TREE_FAMILIES.broadleaf.map(model => [model, 'foliage'] as const),
    ...TREE_FAMILIES.blossom.map(model => [model, 'blossom'] as const),
  ].flatMap(([model, role]) => {
    const entry = { bare: `${model}${BARE_SUFFIX}`, role }
    return [
      [model, entry],
      [`${model}${CROWN_SUFFIX}`, entry],
    ]
  }),
)
