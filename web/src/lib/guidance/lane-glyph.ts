import type { ManeuverKind } from '@/lib/directions/maneuver'
import { laneArrowsFor, type Lane, type LaneArrow } from './lanes'

// Drawn for a 24×24 box from one shared stem; left arrows mirror the right ones.
const PATHS: Record<'through' | 'right' | 'slight-right' | 'uturn', string> = {
  through: 'M12 21V4M8 8l4-4 4 4',
  right: 'M12 21v-3.5a4.5 4.5 0 0 1 4.5-4.5H20M17 9.5l3.5 3.5-3.5 3.5',
  'slight-right': 'M12 21v-4l6.5-6.5M14 10.5h4.5V15',
  uturn: 'M12 21V10a3.5 3.5 0 0 0-7 0v5M2.5 12.5 5 15l2.5-2.5',
}

export interface LaneStroke {
  arrow: LaneArrow
  d: string
  mirrored: boolean
  lit: boolean
}

/** One lane's arrows as strokes off a shared stem, the ones the maneuver uses lit and drawn last. */
export function laneStrokes(lane: Lane, kind: ManeuverKind): LaneStroke[] {
  const wanted = laneArrowsFor(kind)
  const used = lane.valid ? lane.arrows.filter(a => wanted.includes(a)) : []
  const lit = lane.valid && used.length === 0 ? lane.arrows : used
  return lane.arrows
    .map(arrow => {
      const mirrored = arrow === 'left' || arrow === 'slight-left'
      const key = mirrored ? (arrow.replace('left', 'right') as keyof typeof PATHS) : (arrow as keyof typeof PATHS)
      return { arrow, d: PATHS[key], mirrored, lit: lit.includes(arrow) }
    })
    .sort((a, b) => Number(a.lit) - Number(b.lit))
}
