import { describe, it, expect } from 'vitest'
import {
  parseStyleDocument,
  candidateToDraft,
  StyleParseError,
} from './import'

/**
 * Importing is mostly about being honest: a layer that references a sprite or
 * a Mapbox-hosted source will not look the same here, and saying so beats
 * adding something that silently renders nothing.
 */

const STYLE = JSON.stringify({
  version: 8,
  name: 'Terrain v2',
  sources: {
    terrain: { type: 'vector', url: 'https://example/terrain.json' },
    hosted: { type: 'raster', url: 'mapbox://mapbox.satellite' },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
    {
      id: 'contours',
      type: 'line',
      source: 'terrain',
      'source-layer': 'contour',
      paint: { 'line-color': '#a80' },
    },
    { id: 'satellite', type: 'raster', source: 'hosted' },
    { id: 'orphan', type: 'circle', source: 'nowhere' },
  ],
})

describe('parseStyleDocument', () => {
  it('lists the style’s layers and skips the background', () => {
    const parsed = parseStyleDocument(STYLE)

    expect(parsed.name).toBe('Terrain v2')
    expect(parsed.candidates.map(c => c.id)).toEqual([
      'contours',
      'satellite',
      'orphan',
    ])
  })

  it('inlines each layer’s source', () => {
    const [contours] = parseStyleDocument(STYLE).candidates

    expect(contours.configuration.source).toEqual({
      id: 'terrain',
      type: 'vector',
      url: 'https://example/terrain.json',
    })
    expect(contours.importable).toBe(true)
  })

  it('flags mapbox:// sources, which need a token we may not have', () => {
    const satellite = parseStyleDocument(STYLE).candidates[1]

    expect(satellite.warnings).toContain('mapboxProtocol')
  })

  it('will not import a layer whose source is missing from the document', () => {
    const orphan = parseStyleDocument(STYLE).candidates[2]

    expect(orphan.warnings).toContain('missingSource')
    expect(orphan.importable).toBe(false)
  })

  it('warns about sprite images and fonts that do not travel', () => {
    const parsed = parseStyleDocument(
      JSON.stringify({
        sources: { s: { type: 'vector', url: 'https://e/t.json' } },
        layers: [
          {
            id: 'labels',
            type: 'symbol',
            source: 's',
            layout: { 'icon-image': 'marker', 'text-font': ['Custom Bold'] },
          },
        ],
      }),
    )

    expect(parsed.candidates[0].warnings).toEqual(
      expect.arrayContaining(['spriteImage', 'customFont']),
    )
  })

  it('accepts a single layer object pasted on its own', () => {
    const parsed = parseStyleDocument(
      JSON.stringify({ id: 'x', type: 'line', source: 's' }),
    )

    expect(parsed.singleLayer).toBe(true)
    expect(parsed.candidates[0].warnings).toContain('missingSource')
  })

  it('rejects anything that is not a style', () => {
    expect(() => parseStyleDocument('nope')).toThrow(StyleParseError)
    expect(() => parseStyleDocument('{"a":1}')).toThrow(StyleParseError)
    expect(() =>
      parseStyleDocument(JSON.stringify({ layers: [] })),
    ).toThrow(StyleParseError)
  })
})

describe('candidateToDraft', () => {
  it('keeps the style’s own layer id, which its filters are written against', () => {
    const [contours] = parseStyleDocument(STYLE).candidates
    const draft = candidateToDraft(contours)

    expect(draft.layerId).toBe('contours')
    expect(draft.sourceLayer).toBe('contour')
    expect(draft.paint['line-color']).toBe('#a80')
  })
})
