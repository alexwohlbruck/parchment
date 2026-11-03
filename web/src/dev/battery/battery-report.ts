import { formatStopwatch } from '@/lib/time-format'

export interface BatteryReading {
  /** Ms since the run began. */
  t: number
  /** 0–1; null where the platform won't say. */
  level: number | null
  charging: boolean | null
  hidden: boolean
  navigating: boolean
  fixIntervalMs: number
}

export interface BatteryRunMeta {
  saver: string
  device: string
  /** Typed in by hand where the Battery Status API is missing, as on iOS. */
  manual?: { start: number | null; end: number | null }
}

const REFERENCE_MS = 20 * 60_000

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`

function share<T>(readings: BatteryReading[], key: (r: BatteryReading) => T): Map<T, number> {
  const counts = new Map<T, number>()
  for (const r of readings) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1)
  return counts
}

/** The drain over the run, scaled to the ticket's 20 minute reference. */
export function drainPer20Min(startPct: number, endPct: number, elapsedMs: number): number | null {
  return elapsedMs > 0 ? ((startPct - endPct) * REFERENCE_MS) / elapsedMs : null
}

export function batteryReport(readings: BatteryReading[], meta: BatteryRunMeta): string {
  const elapsedMs = readings.at(-1)?.t ?? 0
  const levels = readings.filter(r => r.level != null)
  const start = levels[0]?.level != null ? levels[0].level * 100 : meta.manual?.start ?? null
  const end = levels.at(-1)?.level != null ? levels.at(-1)!.level! * 100 : meta.manual?.end ?? null
  const lines = [`Parchment battery run · ${formatStopwatch(elapsedMs / 1000)} · saver ${meta.saver}`]

  if (start != null && end != null) {
    const drain = drainPer20Min(start, end, elapsedMs)
    const scaled = drain == null ? '' : ` · ${drain.toFixed(1)}% per 20 min`
    lines.push(`Battery ${start.toFixed(0)}% → ${end.toFixed(0)}% (−${(start - end).toFixed(1)}%)${scaled}`)
  } else {
    lines.push('Battery level unavailable')
  }
  if (readings.some(r => r.charging)) lines.push('Warning: charging during the run')

  if (readings.length) {
    const n = readings.length
    lines.push(`Navigating ${percent((share(readings, r => r.navigating).get(true) ?? 0) / n)} · screen hidden ${percent((share(readings, r => r.hidden).get(true) ?? 0) / n)}`)
    const intervals = [...share(readings.filter(r => r.navigating), r => r.fixIntervalMs)]
      .sort(([a], [b]) => a - b)
      .map(([ms, count]) => `${ms / 1000} s ${percent(count / n)}`)
    if (intervals.length) lines.push(`Fix interval ${intervals.join(', ')}`)
  }
  lines.push(`Samples ${readings.length} · ${meta.device}`)
  return lines.join('\n')
}
