import { describe, it, expect } from 'vitest'
import {
  presetLayers,
  defaultStyleFor,
  inferRender,
  countGeometries,
} from './data-presets'

/**
 * A canvas offers four ways to draw a set of features rather than the style
 * spec's nine layer types. The mapping has to be exhaustive — every mode
 * produces something the engine will draw — and geometry-filtered, so a mixed
 * document drawn as shapes shows its polygons instead of nothing.
 */

describe('presetLayers', () => {
  it('draws points as a dot layer over the source', () => {
    const [dot] = presetLayers('points', 'src', undefined)

    expect(dot.configuration.type).toBe('circle')
    expect(dot.configuration.source).toBe('src')
  })

  it('adds a label layer only when a property is chosen', () => {
    expect(presetLayers('points', 'src', {})).toHaveLength(1)

    const withLabels = presetLayers('points', 'src', { labelProperty: 'name' })
    expect(withLabels).toHaveLength(2)
    expect((withLabels[1].configuration.layout as never)['text-field']).toEqual([
      'coalesce',
      ['get', 'name'],
      '',
    ])
  })

  it('draws shapes as a fill plus an outline', () => {
    const layers = presetLayers('shapes', 'src', undefined)

    expect(layers.map(l => l.configuration.type)).toEqual(['fill', 'line'])
  })

  it('filters every mode to the geometry it can actually draw', () => {
    for (const render of ['points', 'lines', 'shapes', 'heatmap'] as const) {
      for (const layer of presetLayers(render, 'src', undefined)) {
        expect(layer.configuration.filter).toBeDefined()
      }
    }
  })

  it('gives each layer a distinct suffix so ids stay stable', () => {
    const suffixes = presetLayers('shapes', 'src', undefined).map(l => l.suffix)

    expect(new Set(suffixes).size).toBe(suffixes.length)
  })

  it('applies the caller’s style over the mode defaults', () => {
    const [line] = presetLayers('lines', 'src', { color: '#ff0000', size: 9 })

    expect((line.configuration.paint as never)['line-color']).toBe('#ff0000')
    expect((line.configuration.paint as never)['line-width']).toBe(9)
  })

  it('starts a heatmap transparent, so it does not wash the viewport', () => {
    const [heat] = presetLayers('heatmap', 'src', undefined)
    const ramp = (heat.configuration.paint as never)['heatmap-color'] as unknown[]

    expect(ramp[4]).toBe('rgba(0,0,0,0)')
  })
})

describe('defaultStyleFor', () => {
  it('gives each mode bounds that make sense for its own knob', () => {
    expect(defaultStyleFor('points').size).toBeLessThan(
      defaultStyleFor('heatmap').size!,
    )
  })
})

describe('inferRender', () => {
  const counts = (collection: unknown) => countGeometries(collection as never)

  it('picks the mode matching the dominant geometry', () => {
    expect(inferRender({ Point: 5 })).toBe('points')
    expect(inferRender({ LineString: 3 })).toBe('lines')
    expect(inferRender({ Polygon: 2 })).toBe('shapes')
  })

  it('counts multi-geometries alongside their singular form', () => {
    expect(inferRender({ Point: 1, MultiPolygon: 4 })).toBe('shapes')
  })

  it('falls back to points for an empty document', () => {
    expect(inferRender({})).toBe('points')
  })

  it('counts geometries out of a collection', () => {
    expect(
      counts({
        features: [
          { geometry: { type: 'Point' } },
          { geometry: { type: 'Point' } },
          { geometry: null },
        ],
      }),
    ).toEqual({ Point: 2 })
  })
})
