/**
 * Deterministic variation.
 *
 * Every object the 3D layer draws needs a size, a heading and a shade, and OSM
 * almost never supplies them. Inventing them at random would shimmer — the
 * instance list is rebuilt on every pan, so a tree would change shape as you
 * moved — and inventing them from the feature's id does not: the same tree gets
 * the same shape every time it is drawn, on every device, forever.
 */

/**
 * A small integer hash. `salt` decorrelates the properties drawn from one id,
 * or height and heading would march in lockstep down a street.
 *
 * FNV-1a, then MurmurHash3's finaliser. The finaliser is not optional here: the
 * ids these hash are `node/12345`-shaped and differ only in their last few
 * characters, and FNV alone barely moves for such an input — a first version
 * without it drew one model for sixty consecutive trees and three distinct
 * heights across twenty. Avalanching once at the end fixes that for free.
 */
export function hash(seed: string | number, salt: number): number {
  let h = 2166136261 ^ salt
  const text = String(seed)
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 16
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  h = Math.imul(h, 3266489909)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export type Range = { min: number; max: number }

export const lerp = (range: Range, t: number) => range.min + (range.max - range.min) * t

/** Pick from a list by hash, so a street draws a mix rather than one clone. */
export const pick = <T>(items: readonly T[], t: number) =>
  items[Math.min(items.length - 1, Math.floor(t * items.length))]

/**
 * A tagged number, if it is a number and it is plausible.
 *
 * OSM heights arrive with units appended, as ranges, as typos and as levels —
 * `parseFloat` takes the leading number, and the bounds throw out the 400-metre
 * trees. Returns null rather than a default so the caller decides the fallback.
 */
export function tagged(value: unknown, low: number, high: number): number | null {
  const n = parseFloat(String(value))
  return Number.isFinite(n) && n >= low && n <= high ? n : null
}
