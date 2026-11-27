import { describe, expect, test } from 'vitest'
import { expression, latest } from '@maplibre/maplibre-gl-style-spec'
import { rampedOpacity, withTileFade, withZoomFades, ZOOM_FADE, TILE_FADE_MS } from './layer-entrance'
import { DETAIL_SOURCE } from './detail-layers'

/** An opacity's value at a zoom, for a feature with these properties. */
function at(value: unknown, zoom: number, properties: Record<string, unknown> = {}): number {
  const parsed = expression.createPropertyExpression(value, 'line-opacity', (latest as any).paint_line['line-opacity'])
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return (parsed.value as any).evaluate({ zoom }, { properties })
}

describe('zoom fades', () => {
  test('a constant opacity rises from nothing at minzoom to itself half a zoom on', () => {
    const paint = withZoomFades({ id: 'x', type: 'line', minzoom: 12, paint: { 'line-opacity': 0.8 } }).paint!
    expect(at(paint['line-opacity'], 12)).toBe(0)
    expect(at(paint['line-opacity'], 12 + ZOOM_FADE / 2)).toBeCloseTo(0.4)
    expect(at(paint['line-opacity'], 15)).toBeCloseTo(0.8)
  })

  test('an unset opacity fades in to full', () => {
    const paint = withZoomFades({ id: 'x', type: 'fill', minzoom: 13 }).paint!
    expect(at(paint['fill-opacity'], 13)).toBe(0)
    expect(at(paint['fill-opacity'], 14)).toBe(1)
  })

  test('an existing zoom curve keeps its shape past the fade', () => {
    const curve = ['interpolate', ['linear'], ['zoom'], 12, 0.4, 18, 1]
    const paint = withZoomFades({ id: 'x', type: 'line', minzoom: 12, paint: { 'line-opacity': curve } }).paint!
    expect(at(paint['line-opacity'], 12)).toBe(0)
    for (const z of [13, 15, 18]) expect(at(paint['line-opacity'], z)).toBeCloseTo(at(curve, z))
  })

  test('a feature-driven opacity fades in feature by feature', () => {
    const value = ['match', ['get', 'kind'], 'a', 0.5, 1]
    const paint = withZoomFades({ id: 'x', type: 'circle', minzoom: 16, paint: { 'circle-opacity': value } }).paint!
    expect(at(paint['circle-opacity'], 16, { kind: 'a' })).toBe(0)
    expect(at(paint['circle-opacity'], 17, { kind: 'a' })).toBeCloseTo(0.5)
    expect(at(paint['circle-opacity'], 17, { kind: 'b' })).toBeCloseTo(1)
  })

  test('a layer with a maxzoom fades out into it', () => {
    const paint = withZoomFades({ id: 'x', type: 'line', minzoom: 13, maxzoom: 17, paint: { 'line-opacity': 0.5 } }).paint!
    expect(at(paint['line-opacity'], 13)).toBe(0)
    expect(at(paint['line-opacity'], 15)).toBeCloseTo(0.5)
    expect(at(paint['line-opacity'], 17)).toBe(0)
  })

  test('leaves alone what already ramps in, is hidden, or sits at the globe edges', () => {
    const ramping = { id: 'x', type: 'line', minzoom: 16, paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 16, 0, 16.6, 1] } }
    expect(withZoomFades(ramping).paint).toEqual(ramping.paint)
    const hidden = { id: 'x', type: 'circle', minzoom: 14, paint: { 'circle-opacity': 0, 'circle-stroke-opacity': 0 } }
    expect(withZoomFades(hidden).paint).toEqual(hidden.paint)
    const globe = { id: 'x', type: 'fill', maxzoom: 8, paint: { 'fill-opacity': 1 } }
    expect(withZoomFades(globe)).toBe(globe)
    const label = { id: 'x', type: 'symbol', minzoom: 14 }
    expect(withZoomFades(label)).toBe(label)
  })

  test('a layer marked to stay opaque is left as it is', () => {
    const tint = { id: 'x', type: 'line', minzoom: 12, metadata: { 'parchment:zoom-fade': false } }
    expect(withZoomFades(tint)).toBe(tint)
  })

  test('a stepped curve is left as it is', () => {
    expect(rampedOpacity(['step', ['zoom'], 0, 14, 1], 12, 12.5)).toBeNull()
  })
})

describe('tile fades', () => {
  test('detail fills and lines fade in as their tile arrives', () => {
    expect(withTileFade({ id: 'x', type: 'line', source: DETAIL_SOURCE }).metadata).toEqual({ 'parchment:tile-fade': TILE_FADE_MS })
    expect(withTileFade({ id: 'x', type: 'fill', source: DETAIL_SOURCE, metadata: { a: 1 } }).metadata).toEqual({ a: 1, 'parchment:tile-fade': TILE_FADE_MS })
  })

  test('other sources and layer types do not', () => {
    const basemap = { id: 'x', type: 'line', source: 'openmaptiles' }
    expect(withTileFade(basemap)).toBe(basemap)
    const label = { id: 'x', type: 'symbol', source: DETAIL_SOURCE }
    expect(withTileFade(label)).toBe(label)
  })
})
