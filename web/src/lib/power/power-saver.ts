import type { PowerSaver, PowerSaverAuto } from '@/types/power.types'

export const POWER_SAVERS: PowerSaver[] = ['off', 'normal', 'extreme']

export const DEFAULT_POWER_SAVER_AUTO: PowerSaverAuto = {
  enabled: false,
  normalAt: 0.2,
  extremeAt: 0.1,
}

export interface BatteryState {
  level: number
  charging: boolean
}

const RANK: Record<PowerSaver, number> = { off: 0, normal: 1, extreme: 2 }

/** The level the battery calls for; `null` when the device won't say. */
export function autoPowerSaver(auto: PowerSaverAuto, battery: BatteryState | null): PowerSaver {
  if (!auto.enabled || !battery || battery.charging) return 'off'
  if (battery.level <= auto.extremeAt) return 'extreme'
  if (battery.level <= auto.normalAt) return 'normal'
  return 'off'
}

export function strongerSaver(a: PowerSaver, b: PowerSaver): PowerSaver {
  return RANK[a] >= RANK[b] ? a : b
}

export function isStronger(a: PowerSaver, b: PowerSaver): boolean {
  return RANK[a] > RANK[b]
}

export interface MapRenderBudget {
  maxPixelRatio: number
  /** Shortest interval between drawn frames; 0 leaves it to the display. */
  minFrameMs: number
}

const MAP_RENDER: Record<PowerSaver, MapRenderBudget> = {
  off: { maxPixelRatio: 2, minFrameMs: 0 },
  normal: { maxPixelRatio: 1.5, minFrameMs: 33 },
  extreme: { maxPixelRatio: 1, minFrameMs: 33 },
}

export function mapRenderBudget(saver: PowerSaver): MapRenderBudget {
  return MAP_RENDER[saver]
}

const POLL_FACTOR: Record<PowerSaver, number> = { off: 1, normal: 3, extreme: 6 }

/** How often to refresh live data that would otherwise poll every `baseMs`. */
export function pollInterval(baseMs: number, saver: PowerSaver): number {
  return baseMs * POLL_FACTOR[saver]
}

const LOCATION_WATCH: Record<PowerSaver, PositionOptions> = {
  off: { enableHighAccuracy: true, maximumAge: 30_000, timeout: 27_000 },
  normal: { enableHighAccuracy: false, maximumAge: 60_000, timeout: 27_000 },
  extreme: { enableHighAccuracy: false, maximumAge: 120_000, timeout: 60_000 },
}

/** Navigation needs every fix it can get, so it always tracks at full accuracy. */
export function locationWatchOptions(saver: PowerSaver, navigating: boolean): PositionOptions {
  return LOCATION_WATCH[navigating ? 'off' : saver]
}
