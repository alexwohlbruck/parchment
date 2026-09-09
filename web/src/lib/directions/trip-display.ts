/**
 * Pure formatting and rail-paint rules for the trip timeline.
 *
 * Kept out of the view so each rule can be read — and tested — on its own.
 */
export const TRIP_MODE_COLORS = {
  walking: 'bg-cobalt-500',
  driving: 'bg-violet-500',
  cycling: 'bg-forest-500',
  biking: 'bg-forest-500',
  transit: 'bg-parchment-500',
  truck: 'bg-compass-500',
} as const

const DEFAULT_MODE_COLOR = 'bg-parchment-500'
const EMPTY_RAIL_COLOR = 'bg-border'

export function modeColor(mode: string): string {
  return (
    TRIP_MODE_COLORS[mode as keyof typeof TRIP_MODE_COLORS] ?? DEFAULT_MODE_COLOR
  )
}

/** Clock time without the am/pm marker, which the surrounding row implies. */
export function formatClockCompact(date: Date): string {
  return new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })
    .formatToParts(date)
    .filter(p => p.type !== 'dayPeriod')
    .map(p => p.value)
    .join('')
    .trim()
}

/**
 * Lead line and clock sub-line for a departure chip. Departure is detected by
 * the sign of the delta, not the rounded minute, so the last thirty seconds
 * before a run leaves never reads as "now".
 */
export function depCountdown(
  ms: number,
  nowMs: number,
): { lead: string; sub: string } {
  const sub = formatClockCompact(new Date(ms))
  const deltaMs = ms - nowMs

  if (deltaMs < 0) {
    const ago = Math.max(1, Math.round(-deltaMs / 60_000))
    return { lead: ago < 60 ? `${ago}m ago` : 'departed', sub }
  }

  const min = Math.round(deltaMs / 60_000)
  if (min === 0) return { lead: 'now', sub }
  if (min < 60) return { lead: `${min} min`, sub }

  const h = Math.floor(min / 60)
  const m = min % 60
  return { lead: m ? `${h}h ${m}m` : `${h}h`, sub }
}

export function joinStatus(base: string, extra: string | null): string {
  return extra ? `${base} — ${extra}` : base
}

export function formatCo2(kg: number): string {
  return kg >= 1 ? `${kg.toFixed(1)} kg` : `${Math.round(kg * 1000)} g`
}

export function movingDuration(segment: {
  duration?: number
  waitSeconds?: number
}): number {
  return Math.max(0, (segment.duration || 0) - (segment.waitSeconds ?? 0))
}

/** Waits under a minute are timetable noise rather than something to show. */
export function waitMinutes(segment: { waitSeconds?: number }): number {
  const w = segment.waitSeconds ?? 0
  return w >= 60 ? Math.round(w / 60) : 0
}

/**
 * A real entrance name reads "Enter at <name>". A train-direction description
 * says which platform a stair serves — useful entering, noise exiting, since
 * you are heading for the street. Empty when the entrance carries nothing
 * usable; never fabricated.
 */
export function entrancePhrase(
  entrance:
    | { role?: string; name?: string | null; description?: string | null }
    | null
    | undefined,
): string {
  if (!entrance) return ''
  const verb = entrance.role === 'exit' ? 'Exit' : 'Enter'
  if (entrance.name) return `${verb} at ${entrance.name}`
  if (entrance.role !== 'exit' && entrance.description) {
    return `${verb} · ${entrance.description}`
  }
  return ''
}

/** Paint for the rail inside a transit card: the line's own colour, full strength. */
export function segmentRail(segment: {
  mode?: string
  lineColor?: string | null
}): { class?: string; style?: Record<string, string> } {
  if (segment.lineColor) {
    return { style: { background: `#${segment.lineColor}` } }
  }
  return { class: modeColor(segment.mode ?? '') }
}

type RailEntry =
  | { kind: 'segment'; segment: { mode?: string; lineColor?: string | null } }
  | { kind: string }

/** The rail takes its colour from the nearest segment in the given direction. */
export function railColorAt(
  entries: RailEntry[],
  entryIndex: number,
  position: 'above' | 'below',
): string {
  const step = position === 'above' ? -1 : 1
  for (let j = entryIndex + step; j >= 0 && j < entries.length; j += step) {
    const e = entries[j]
    if (e.kind === 'segment') {
      return modeColor((e as { segment: { mode?: string } }).segment.mode ?? '')
    }
  }
  return EMPTY_RAIL_COLOR
}

export function railStyleAt(
  entries: RailEntry[],
  entryIndex: number,
  position: 'above' | 'below',
): Record<string, string> {
  const step = position === 'above' ? -1 : 1
  for (let j = entryIndex + step; j >= 0 && j < entries.length; j += step) {
    const e = entries[j]
    if (e.kind !== 'segment') continue
    const { lineColor } = (e as { segment: { lineColor?: string | null } }).segment
    return lineColor ? { background: `#${lineColor}` } : {}
  }
  return {}
}
