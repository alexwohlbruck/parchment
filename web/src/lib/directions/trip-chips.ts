/**
 * The leg strip under a trip in list view — "walk 5 › B45 › walk 2".
 *
 * One chip per travelled leg, in order. Walking chips carry minutes and
 * absorb the wait folded into them; vehicle legs carry their line badge.
 */
import { movingDuration } from './trip-display'

export interface ChipSegment {
  mode: string
  duration?: number
  waitSeconds?: number
  routeType?: string
  lineName?: string | null
  lineColor?: string | null
  lineTextColor?: string | null
}

export type TripChip =
  | { kind: 'walk'; minutes: number }
  | {
      kind: 'transit'
      label: string | null
      routeType?: string
      color?: string
      textColor?: string
    }
  | { kind: 'vehicle'; mode: string; minutes: number }

export function tripChips(segments: ChipSegment[]): TripChip[] {
  const chips: TripChip[] = []

  for (const seg of segments) {
    if (seg.mode === 'walking') {
      const minutes = Math.round(movingDuration(seg) / 60)
      // A walk that rounds to nothing is a doorway, not a leg.
      if (minutes < 1) continue
      const last = chips[chips.length - 1]
      if (last?.kind === 'walk') last.minutes += minutes
      else chips.push({ kind: 'walk', minutes })
      continue
    }

    if (seg.mode === 'transit') {
      chips.push({
        kind: 'transit',
        label: seg.lineName || null,
        routeType: seg.routeType,
        color: seg.lineColor || undefined,
        textColor: seg.lineTextColor || undefined,
      })
      continue
    }

    chips.push({
      kind: 'vehicle',
      mode: seg.mode,
      minutes: Math.round(movingDuration(seg) / 60),
    })
  }

  return chips
}
