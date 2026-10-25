// Turn arrows drawn for a 24×24 box, travelling up; left variants mirror the right ones.

import type { ManeuverKind } from './maneuver'

const PATHS: Record<string, string> = {
  straight: 'M12 21V4M6.5 9.5 12 4l5.5 5.5',
  'slight-right': 'M8 21v-6.5c0-2 .8-3.4 2.2-4.8L16 4M10.5 4H16v5.5',
  right: 'M7 21v-8a4 4 0 0 1 4-4h9M15 4l5 5-5 5',
  'sharp-right': 'M6 21V9a3 3 0 0 1 5.1-2.1L18.5 14.3M18.5 8.3v6h-6',
  'keep-right': 'M8 21v-5c0-2.2 1-3.6 2.5-4.8L15 8M8 15V4M11 8h4v4',
  uturn: 'M16 21V10a5 5 0 0 0-10 0v6M2.5 13 6 16.5 9.5 13',
  roundabout: 'M16 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 21v-7M15.5 7.5 20 3M16 3h4v4',
  arrive: 'M6 21V4M6 4h10l-2 4 2 4H6',
  board: 'M8 3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM5 10h14M9 21l1.5-4M15 21l-1.5-4',
}

export const MANEUVER_ICON_VIEWBOX = '0 0 24 24'
export const MANEUVER_ICON_STROKE = 2.4

/** The path for a maneuver's arrow, and whether it is drawn mirrored. */
export function maneuverIcon(kind: ManeuverKind): { d: string; mirrored: boolean } {
  const mirrored = kind === 'left' || kind.endsWith('-left')
  const key = kind === 'left' ? 'right' : kind.replace('-left', '-right')
  return { d: PATHS[key] ?? PATHS.straight, mirrored }
}

export const MIRROR_TRANSFORM = 'matrix(-1 0 0 1 24 0)'
