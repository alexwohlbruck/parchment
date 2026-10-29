import { projectLatLng } from '@/lib/map/movement-interpolation'
import type { LngLat } from '@/types/map.types'
import type { NavSegmentInput } from './nav-route'

const ORIGIN: LngLat = { lat: 35.2271, lng: -80.8431 }

/** A polyline walked from ORIGIN as (bearing, metres) legs, one vertex per metre step. */
export function polyline(legs: [bearing: number, metres: number][], origin = ORIGIN): LngLat[] {
  const points = [origin]
  let cursor = origin
  for (const [bearing, metres] of legs) {
    const steps = Math.max(1, Math.round(metres / 10))
    for (let i = 0; i < steps; i++) {
      cursor = projectLatLng(cursor, metres / steps, bearing, 1)
      points.push(cursor)
    }
  }
  return points
}

/** 600 m north, right turn, 400 m east, left turn, 500 m north. */
export function cityDrive(): NavSegmentInput {
  const geometry = polyline([
    [0, 600],
    [90, 400],
    [0, 500],
  ])
  return {
    mode: 'driving',
    geometry,
    instructions: [
      { type: 'depart', text: 'Head north', coordinate: geometry[0], distance: 600, duration: 60 },
      { type: 'turn', modifier: 'right', text: 'Turn right', coordinate: geometry[60], distance: 400, duration: 40 },
      { type: 'turn', modifier: 'left', text: 'Turn left', coordinate: geometry[100], distance: 500, duration: 50 },
      { type: 'destination', text: 'Arrive', coordinate: geometry[150], distance: 0, duration: 0 },
    ],
    edgeSegments: [{ startDistance: 0, endDistance: 1500, speedLimit: 50 }],
  }
}

/** A `t` over one locale's messages, filling `{name}` placeholders. */
export function translator(messages: object) {
  return (key: string, named: Record<string, unknown> = {}) => {
    const value = key.split('.').reduce<any>((node, part) => node?.[part], messages)
    if (typeof value !== 'string') throw new Error(`Missing message ${key}`)
    return value.replace(/\{(\w+)\}/g, (_, k) => String(named[k] ?? ''))
  }
}
