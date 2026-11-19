import { describe, expect, test } from 'vitest'
import { mapboxLayerToMaplibreLayer, withEmissive } from './mapbox-style-compat'
import { MapEngine } from '@/types/map.types'

const font = (textFont: string[]) =>
  (mapboxLayerToMaplibreLayer({
    configuration: { id: 'labels', type: 'symbol', source: 's', layout: { 'text-font': textFont } },
  } as any) as any).configuration.layout['text-font']

describe('text-font', () => {
  test('maps a Mapbox face to its MapLibre one', () => {
    expect(font(['DIN Pro Medium', 'Arial Unicode MS Regular'])).toEqual(['Geist SemiBold'])
  })

  test('keeps a face that is already MapLibre, as one copied from the basemap is', () => {
    expect(font(['Geist SemiBold'])).toEqual(['Geist SemiBold'])
  })

  test('falls back to Regular for an unknown face', () => {
    expect(font(['Open Sans Regular'])).toEqual(['Geist Regular'])
  })
})

describe('withEmissive', () => {
  const line = { type: 'line', paint: { 'line-width': 3 } }

  test('lights an overlay on Mapbox', () => {
    expect(withEmissive(line, MapEngine.MAPBOX).paint).toEqual({
      'line-width': 3,
      'line-emissive-strength': 1,
    })
  })

  test('leaves MapLibre layers alone, which reject the property', () => {
    expect(withEmissive(line, MapEngine.MAPLIBRE)).toBe(line)
  })
})
