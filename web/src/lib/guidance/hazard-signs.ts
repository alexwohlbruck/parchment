// Lights and rail crossings drawn as small signs on the route, in logical pixels.

import { palette } from '@/lib/palette'
import type { HazardSignKind } from './hazard-callouts'

export interface SignStroke {
  d: string
  fill?: string
  stroke?: string
  width?: number
}

export interface HazardSign {
  width: number
  height: number
  /** Painted in order, so outlines go first. */
  strokes: SignStroke[]
}

const lamp = (cy: number, fill: string): SignStroke => ({ d: `M4.6 ${cy}a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 1 0-4.8 0Z`, fill })

export const HAZARD_SIGNS: Record<HazardSignKind, HazardSign> = {
  traffic_signals: {
    width: 14,
    height: 26,
    strokes: [
      { d: 'M4 1h6a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Z', fill: palette.ink[950], stroke: '#ffffff', width: 1.5 },
      lamp(6.5, '#f0533f'),
      lamp(13, '#f5b52e'),
      lamp(19.5, '#3cba6a'),
    ],
  },
  rail_crossing: {
    width: 22,
    height: 22,
    strokes: [
      { d: 'M2.6 2.6l16.8 16.8M19.4 2.6 2.6 19.4', stroke: '#ffffff', width: 8 },
      { d: 'M3.5 3.5l15 15M18.5 3.5l-15 15', stroke: palette.compass[500], width: 5.5 },
      { d: 'M4.5 4.5l13 13M17.5 4.5l-13 13', stroke: '#ffffff', width: 2.5 },
    ],
  },
}
