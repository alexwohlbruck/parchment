// Where each moment of a trip falls on its bar: time-proportional, except that every ride keeps room for its badge.

export interface BarScaleSegment {
  mode: string
  startTime: Date | string
  duration: number
  lineName?: string
}

/** Clear space either side of a ride's badge, so neighbouring badges don't touch. */
const BADGE_GAP = 6
const BADGE = 22

/** A route bullet's width: one or two glyphs sit in a circle, a longer name becomes a pill. */
export function badgeWidth(segment: BarScaleSegment): number {
  const label = segment.mode === 'transit' ? segment.lineName ?? '' : ''
  return label.length <= 2 ? BADGE : 12 + 7 * label.length
}

const isRide = (segment: BarScaleSegment, walkingOnly: boolean) => segment.mode !== 'walking' || walkingOnly

/**
 * Maps a time (ms) onto [0, width] px, laid out from `start` to `end`. Each ride is
 * stretched to at least its badge's width; the rest of the bar shrinks to make room.
 */
export function tripBarScale(
  segments: BarScaleSegment[],
  start: number,
  end: number,
  width: number,
): (ms: number) => number {
  const walkingOnly = segments.length > 0 && segments.every(s => s.mode === 'walking')
  const cuts = new Map<number, number>([[start, 0], [end, 0]])
  for (const segment of segments) {
    const from = new Date(segment.startTime).getTime()
    const to = from + segment.duration * 1000
    if (!isRide(segment, walkingOnly) || to <= from) continue
    cuts.set(from, cuts.get(from) ?? 0)
    cuts.set(to, cuts.get(to) ?? 0)
  }
  const times = [...cuts.keys()].filter(t => t >= start && t <= end).sort((a, b) => a - b)
  const span = end - start || 1

  const intervals = times.slice(1).map((to, i) => {
    const from = times[i]
    const ride = segments.find(s => {
      const s0 = new Date(s.startTime).getTime()
      return isRide(s, walkingOnly) && s0 <= from && s0 + s.duration * 1000 >= to
    })
    const rideSpan = ride ? ride.duration * 1000 : 0
    return {
      natural: ((to - from) / span) * width,
      min: ride && rideSpan ? ((badgeWidth(ride) + BADGE_GAP) * (to - from)) / rideSpan : 0,
      fixed: false,
    }
  })

  for (;;) {
    const fixedWidth = intervals.reduce((sum, iv) => sum + (iv.fixed ? iv.min : 0), 0)
    const freeNatural = intervals.reduce((sum, iv) => sum + (iv.fixed ? 0 : iv.natural), 0)
    const scale = freeNatural ? Math.max(0, width - fixedWidth) / freeNatural : 0
    const short = intervals.filter(iv => !iv.fixed && iv.natural * scale < iv.min)
    if (!short.length) {
      const widths = intervals.map(iv => (iv.fixed ? iv.min : iv.natural * scale))
      return interpolate(times, widths)
    }
    for (const iv of short) iv.fixed = true
  }
}

function interpolate(times: number[], widths: number[]): (ms: number) => number {
  const xs = [0]
  widths.forEach(w => xs.push(xs.at(-1)! + w))
  return ms => {
    if (ms <= times[0]) return 0
    const i = times.findIndex(t => t >= ms)
    if (i < 0) return xs.at(-1)!
    const t0 = times[i - 1]
    const t1 = times[i]
    return xs[i - 1] + ((ms - t0) / (t1 - t0 || 1)) * (xs[i] - xs[i - 1])
  }
}
