/**
 * The plants' year: the colour every leafy role takes on each day, and how much of
 * its leaf it carries.
 *
 * Each role is a ramp of keyframes through a northern year, resampled to `RAMP`
 * evenly spaced steps the shader blends between. Every plant reads the ramp a few
 * days early or late (see `phaseOf`), so a street turns tree by tree rather than all
 * at once. Where a deciduous tree carries less than a full crown its bare branches
 * are drawn under it, and the crown thins to show them.
 */
import type { FlavorId } from '@/lib/map-style/build'
import { TREE_FAMILIES } from './trees'
import { CROWN_SUFFIX } from './forest'

/** Steps a ramp is resampled to; the shader's `u_ramp` holds this many. */
export const RAMP = 48

/** How far either side of the date a plant's own season may run, as a share of the year. */
export const PHASE_SPREAD = 13 / 365

/** Latitudes nearer the equator than this stay in high summer all year. */
const EVERGREEN_LATITUDE = 27
const MIDSUMMER = 182 / 365

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
/** Day of a northern year, the colour and its tinted alternate, and the share of leaf on. */
type Key = [day: number, color: Rgb, alt: Rgb, leaf: number]

const DORMANT: Rgb = [0.62, 0.5, 0.38]

const KEYS: Record<string, Key[]> = {
  // Broadleaves: bare until April, chartreuse at budburst, lime in May, deep through
  // summer, then gold to crimson through October and brown as the leaves come down.
  foliage: [
    [80, [0.74, 0.84, 0.42], [0.7, 0.8, 0.44], 0],
    [100, [0.8, 0.92, 0.45], [0.72, 0.9, 0.5], 0.45],
    [125, [0.74, 0.9, 0.44], [0.64, 0.86, 0.5], 1],
    [165, [0.62, 0.81, 0.47], [0.52, 0.75, 0.5], 1],
    [230, [0.58, 0.76, 0.44], [0.5, 0.7, 0.46], 1],
    [262, [0.7, 0.78, 0.4], [0.68, 0.64, 0.34], 1],
    [287, [0.95, 0.75, 0.28], [0.82, 0.33, 0.18], 1],
    [305, [0.9, 0.6, 0.26], [0.68, 0.3, 0.2], 0.75],
    [322, [0.72, 0.5, 0.3], [0.58, 0.36, 0.26], 0.3],
    [338, DORMANT, DORMANT, 0],
  ],
  // Flowering cherries: pink on bare wood in late March, petals giving way to leaf in
  // late April, green through summer, orange and red before they drop.
  blossom: [
    [78, [0.98, 0.74, 0.84], [0.99, 0.9, 0.93], 0],
    [88, [0.98, 0.74, 0.84], [0.99, 0.9, 0.93], 0.8],
    [104, [0.98, 0.76, 0.86], [0.99, 0.9, 0.93], 1],
    [116, [0.84, 0.86, 0.6], [0.9, 0.84, 0.78], 1],
    [132, [0.66, 0.86, 0.47], [0.58, 0.82, 0.5], 1],
    [170, [0.58, 0.78, 0.46], [0.5, 0.73, 0.48], 1],
    [262, [0.62, 0.76, 0.42], [0.56, 0.7, 0.42], 1],
    [285, [0.93, 0.56, 0.28], [0.78, 0.28, 0.2], 1],
    [303, [0.86, 0.46, 0.24], [0.7, 0.26, 0.2], 0.5],
    [318, [0.7, 0.45, 0.3], [0.6, 0.36, 0.26], 0],
  ],
  // Evergreens only deepen in winter and brighten with new growth.
  needles: [
    [15, [0.4, 0.56, 0.42], [0.35, 0.5, 0.43], 1],
    [130, [0.54, 0.75, 0.47], [0.47, 0.69, 0.49], 1],
    [190, [0.5, 0.7, 0.46], [0.43, 0.64, 0.48], 1],
    [290, [0.47, 0.65, 0.45], [0.41, 0.6, 0.46], 1],
    [345, [0.41, 0.57, 0.42], [0.36, 0.51, 0.43], 1],
  ],
  frond: [
    [0, [0.66, 0.83, 0.5], [0.55, 0.77, 0.52], 1],
  ],
  // Hedges and shrubs keep their leaf, dull olive in winter and russet in fall.
  shrub: [
    [15, [0.52, 0.6, 0.42], [0.6, 0.52, 0.42], 1],
    [115, [0.7, 0.88, 0.46], [0.62, 0.84, 0.5], 1],
    [190, [0.62, 0.8, 0.48], [0.54, 0.75, 0.5], 1],
    [262, [0.62, 0.76, 0.44], [0.62, 0.62, 0.38], 1],
    [293, [0.66, 0.68, 0.4], [0.76, 0.42, 0.26], 1],
    [335, [0.54, 0.6, 0.42], [0.6, 0.52, 0.42], 1],
  ],
  // Bedding: daffodils, then tulips, summer annuals, mums in fall, nothing in winter.
  bloom: [
    [60, DORMANT, DORMANT, 0],
    [80, [0.99, 0.86, 0.34], [0.99, 0.94, 0.7], 0.5],
    [110, [0.96, 0.46, 0.58], [0.99, 0.86, 0.34], 1],
    [180, [0.9, 0.52, 0.68], [0.96, 0.82, 0.36], 1],
    [245, [0.84, 0.4, 0.62], [0.95, 0.7, 0.3], 1],
    [283, [0.94, 0.62, 0.22], [0.64, 0.22, 0.3], 1],
    [318, [0.7, 0.45, 0.3], [0.6, 0.36, 0.26], 0.4],
    [340, DORMANT, DORMANT, 0],
  ],
  // A distant bare crown's fine twigs: a pale veil, mostly sky.
  twigs: [
    [0, [0.66, 0.6, 0.58], [0.6, 0.55, 0.54], 0.45],
  ],
}

/** A role's year, resampled: `color` holds rgb and leaf per step, `alt` the tinted rgb. */
export type SeasonRamp = { color: Float32Array; alt: Float32Array }

/** Night colours from day ones: darker, deeper, and a little greyer, as the night palette is. */
function night([r, g, b]: Rgb): Rgb {
  const deep = [r, g, b].map(c => c ** 2.2 * 0.48)
  const grey = (deep[0] + deep[1] + deep[2]) / 3
  return deep.map(c => c * 0.8 + grey * 0.2) as Rgb
}

function sample(keys: Key[], day: number): { color: Rgb; alt: Rgb; leaf: number } {
  const next = keys.findIndex(k => k[0] > day)
  const b = keys[next === -1 ? 0 : next]
  const a = keys[next <= 0 ? keys.length - 1 : next - 1]
  const span = (b[0] - a[0] + 365) % 365 || 365
  const t = ((day - a[0] + 365) % 365) / span
  const mix = (x: Rgb, y: Rgb) => x.map((c, i) => c + (y[i] - c) * t) as Rgb
  return { color: mix(a[1], b[1]), alt: mix(a[2], b[2]), leaf: a[3] + (b[3] - a[3]) * t }
}

function resample(keys: Key[], flavor: FlavorId): SeasonRamp {
  const color = new Float32Array(RAMP * 4)
  const alt = new Float32Array(RAMP * 3)
  for (let i = 0; i < RAMP; i++) {
    const at = sample(keys, (i / RAMP) * 365)
    const c = flavor === 'dark' ? night(at.color) : at.color
    const a = flavor === 'dark' ? night(at.alt) : at.alt
    color.set([...c, at.leaf], i * 4)
    alt.set(a, i * 3)
  }
  return { color, alt }
}

const RAMPS: Record<FlavorId, Record<string, SeasonRamp>> = {
  light: Object.fromEntries(Object.entries(KEYS).map(([role, keys]) => [role, resample(keys, 'light')])),
  dark: Object.fromEntries(Object.entries(KEYS).map(([role, keys]) => [role, resample(keys, 'dark')])),
}

/** Every leafy role's year, for a flavor. */
export function seasonRamps(flavor: FlavorId): Record<string, SeasonRamp> {
  return RAMPS[flavor]
}

/** A role's colour, its alternate and its leaf at a point in the year; the shader's lookup, for the CPU. */
export function rampAt(ramp: SeasonRamp, year: number): { color: Rgb; alt: Rgb; leaf: number } {
  const at = (((year % 1) + 1) % 1) * RAMP
  const i = Math.floor(at) % RAMP
  const j = (i + 1) % RAMP
  const t = at - Math.floor(at)
  const lerp = (data: Float32Array, size: number, k: number) => data[i * size + k] + (data[j * size + k] - data[i * size + k]) * t
  return {
    color: [0, 1, 2].map(k => lerp(ramp.color, 4, k)) as Rgb,
    alt: [0, 1, 2].map(k => lerp(ramp.alt, 3, k)) as Rgb,
    leaf: lerp(ramp.color, 4, 3),
  }
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
