import { ShadowMode } from '@/types/map.types'

/** Pitch in degrees over which "when tilted" shadows ease in, so tilting never pops them on. */
export const TILT_FADE_PITCH: readonly [number, number] = [2, 8]

/** How much of the cast shadow and ground occlusion to draw, 0 to 1, at this camera pitch. */
export function shadowStrength(mode: ShadowMode, pitch: number): number {
  if (mode === ShadowMode.OFF) return 0
  if (mode !== ShadowMode.TILTED) return 1
  const [from, to] = TILT_FADE_PITCH
  const t = Math.min(Math.max((pitch - from) / (to - from), 0), 1)
  return t * t * (3 - 2 * t)
}
