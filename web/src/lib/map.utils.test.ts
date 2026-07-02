import { describe, expect, test } from 'vitest'
import { degradeProgressLineOffset } from './map.utils'

/**
 * Engine degradation for transit v3 junction transitions: engines without the
 * MapLibre variable-line-offset fork (Mapbox GL, stock MapLibre) cannot
 * evaluate ['line-progress'] inside `line-offset`, so the transition layers'
 * interpolation must collapse to its progress-0 output — the constant
 * ['get', 'off_from_px'] "step" degradation. Steady layers are untouched.
 */

const TRANSITION_OFFSET = [
  'interpolate',
  ['cubic-bezier', 0.4, 0, 0.6, 1],
  ['line-progress'],
  0, ['get', 'off_from_px'],
  1, ['get', 'off_to_px'],
]

describe('degradeProgressLineOffset', () => {
  test('replaces the transition interpolation with the from-offset', () => {
    const paint: Record<string, any> = {
      'line-color': '#ff0000',
      'line-offset': structuredClone(TRANSITION_OFFSET),
    }
    degradeProgressLineOffset(paint)
    expect(paint['line-offset']).toEqual(['get', 'off_from_px'])
    expect(paint['line-color']).toBe('#ff0000') // other props untouched
  })

  test('leaves the steady constant offset untouched', () => {
    const paint: Record<string, any> = { 'line-offset': ['get', 'offset_px'] }
    degradeProgressLineOffset(paint)
    expect(paint['line-offset']).toEqual(['get', 'offset_px'])
  })

  test('leaves numeric and absent line-offset untouched', () => {
    const numeric: Record<string, any> = { 'line-offset': 3 }
    degradeProgressLineOffset(numeric)
    expect(numeric['line-offset']).toBe(3)

    const none: Record<string, any> = { 'line-width': 2 }
    degradeProgressLineOffset(none)
    expect(none).toEqual({ 'line-width': 2 })

    expect(() => degradeProgressLineOffset(undefined)).not.toThrow()
  })

  test('falls back to 0 for a non-interpolate progress expression', () => {
    const paint: Record<string, any> = {
      'line-offset': ['*', ['line-progress'], 4],
    }
    degradeProgressLineOffset(paint)
    expect(paint['line-offset']).toBe(0)
  })
})
