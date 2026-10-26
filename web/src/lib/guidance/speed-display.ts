export const SPEED_DISPLAYS = ['both', 'limit', 'speedometer', 'none'] as const
export type SpeedDisplay = (typeof SPEED_DISPLAYS)[number]

export type Speeding = 'under' | 'over' | 'far-over'

/** Over the limit at all, then by more than a tenth of it. */
export function speeding(current: number, limit: number | null): Speeding {
  if (limit == null || current <= limit) return 'under'
  return current > limit * 1.1 ? 'far-over' : 'over'
}

export function showsLimit(display: SpeedDisplay): boolean {
  return display === 'both' || display === 'limit'
}

export function showsSpeedometer(display: SpeedDisplay): boolean {
  return display === 'both' || display === 'speedometer'
}

/** Metres per second in the traveller's units, as a dashboard shows it. */
export function displaySpeed(metersPerSecond: number, metric: boolean): number {
  return Math.round(metersPerSecond * (metric ? 3.6 : 2.236936))
}
