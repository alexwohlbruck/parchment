import { describe, it, expect } from 'vitest'
import {
  markerCss,
  markerGlyphSize,
  markerGlyphSizeForRadius,
  markerImageId,
  markerLayers,
  markerPaint,
  parseMarkerImageId,
  MARKER_GLYPH_RATIO,
  MARKER_IMAGE_SIZE,
  MARKER_PLATE_SIZE,
  MARKER_RING_WIDTH,
  MARKER_SHAPES,
} from './index'

/**
 * The point of this module is that five surfaces stop disagreeing about what a
 * place marker is, so what is worth pinning down is the agreements — a glyph is
 * the same share of its plate however the plate is drawn, a DOM marker occupies
 * the same space as the layer-drawn one beside it, and the placement rules that
 * only misbehave under a tilted camera are actually present.
 */

describe('glyph sizing', () => {
  it('holds the glyph at its share of the plate, whichever end you measure from', () => {
    // The two helpers exist because callers have either a plate width or a
    // circle radius in hand. They must not be two different answers.
    expect(markerGlyphSizeForRadius(MARKER_PLATE_SIZE / 2)).toBe(
      markerGlyphSize(MARKER_PLATE_SIZE),
    )
  })

  it('resolves to the ratio the basemap sprites use', () => {
    // `icon-size` is a multiple of the registered image, so the drawn glyph is
    // size * MARKER_IMAGE_SIZE — which has to come back to the plate's share.
    const drawn = markerGlyphSize(MARKER_PLATE_SIZE) * MARKER_IMAGE_SIZE
    expect(drawn / MARKER_PLATE_SIZE).toBeCloseTo(MARKER_GLYPH_RATIO, 2)
  })

  it('scales with the plate rather than sitting at a fixed size', () => {
    expect(markerGlyphSize(MARKER_PLATE_SIZE * 2)).toBeCloseTo(
      markerGlyphSize(MARKER_PLATE_SIZE) * 2,
      3,
    )
  })
})

describe('paint', () => {
  it('gives a plated shape a plate, and a bare glyph none', () => {
    expect(markerPaint('#3b82f6', 'disc', false).plate).toBeTruthy()
    expect(markerPaint('#3b82f6', 'square', false).plate).toBeTruthy()
    expect(markerPaint('#3b82f6', 'glyph', false).plate).toBeNull()
  })

  it('draws a bare glyph in a colour that stands on open map', () => {
    // The solid tint's foreground is meant to sit on a pale plate; used alone
    // it is nearly black. The ghost tint is the one that reads unbacked.
    const plated = markerPaint('#3b82f6', 'disc', false)
    const bare = markerPaint('#3b82f6', 'glyph', false)
    expect(bare.ink).not.toBe(plated.ink)
  })

  it('turns the halo over with the map', () => {
    expect(markerPaint('#3b82f6', 'glyph', false).ring).toBe('#FFFFFF')
    expect(markerPaint('#3b82f6', 'glyph', true).ring).toBe('#0D0D0D')
  })

  it('falls back to a flat marker rather than none when a colour will not parse', () => {
    // Throwing here would take the whole layer down with it.
    const paint = markerPaint('not-a-colour', 'disc', false)
    expect(paint.plate).toBe('not-a-colour')
    expect(paint.ink).toBeTruthy()
  })
})

describe('the DOM form', () => {
  const paint = markerPaint('#3b82f6', 'disc', false)

  it('occupies the plate plus its ring, the way the circle layer does', () => {
    const css = markerCss(paint, 'disc')
    expect(css.plate.width).toBe(`${MARKER_PLATE_SIZE + MARKER_RING_WIDTH * 2}px`)
  })

  it('rounds a square by a share of its side rather than into a lozenge', () => {
    const square = markerCss(markerPaint('#3b82f6', 'square', false), 'square')
    const radius = parseFloat(square.plate.borderRadius)
    expect(radius).toBeGreaterThan(0)
    expect(radius).toBeLessThan(MARKER_PLATE_SIZE / 2)
  })

  it('leaves a bare glyph with no plate to see', () => {
    const glyph = markerCss(markerPaint('#3b82f6', 'glyph', false), 'glyph')
    expect(glyph.plate.backgroundColor).toBeUndefined()
    expect(glyph.plate.border).toBeUndefined()
    expect(glyph.plate.filter).toContain('drop-shadow')
  })

  it('scales the whole mark from one number', () => {
    const big = markerCss(paint, 'disc', MARKER_PLATE_SIZE * 2)
    expect(big.plate.width).toBe(
      `${MARKER_PLATE_SIZE * 2 + MARKER_RING_WIDTH * 2}px`,
    )
    expect(parseFloat(big.glyph.width)).toBeCloseTo(
      MARKER_PLATE_SIZE * 2 * MARKER_GLYPH_RATIO,
      2,
    )
  })
})

describe('the native form', () => {
  const base = { id: 'pins', source: 'src', image: ['get', 'markerImage'] }

  it('draws a disc as a circle plate with a glyph over it', () => {
    const layers = markerLayers({ ...base, shape: 'disc' })
    expect(layers.map(l => l.type)).toEqual(['circle', 'symbol'])
    expect(layers.map(l => l.id)).toEqual(['pins', 'pins-glyph'])
  })

  it('draws the other shapes as one symbol, since the plate is in the image', () => {
    for (const shape of ['square', 'glyph'] as const) {
      const layers = markerLayers({ ...base, shape })
      expect(layers).toHaveLength(1)
      expect(layers[0].type).toBe('symbol')
      // Not `-glyph`: there is no plate layer for it to be the other half of.
      expect(layers[0].id).toBe('pins')
    }
  })

  it('pins plate and glyph to the same space, or they separate under pitch', () => {
    const [plate, glyph] = markerLayers({ ...base, shape: 'disc' })
    expect(plate.paint?.['circle-pitch-alignment']).toBe('viewport')
    expect(plate.paint?.['circle-pitch-scale']).toBe('viewport')
    expect(glyph.layout?.['icon-pitch-alignment']).toBe('viewport')
    expect(glyph.layout?.['icon-rotation-alignment']).toBe('viewport')
  })

  it('never lets a glyph be culled out of its plate', () => {
    const [, glyph] = markerLayers({ ...base, shape: 'disc' })
    expect(glyph.layout?.['icon-allow-overlap']).toBe(true)
    expect(glyph.layout?.['icon-ignore-placement']).toBe(true)
  })

  it('keeps `symbol-z-elevate` off, which would lift the glyph off its dot', () => {
    const [, glyph] = markerLayers({ ...base, shape: 'disc' })
    expect(glyph.layout?.['symbol-z-elevate']).toBeUndefined()
  })

  it('fades the ring with the fill, so no outline is left behind', () => {
    const [plate] = markerLayers({ ...base, shape: 'disc', plateOpacity: 0.5 })
    expect(plate.paint?.['circle-opacity']).toBe(0.5)
    expect(plate.paint?.['circle-stroke-opacity']).toBe(0.5)
  })

  it('carries a filter down to every layer it produces', () => {
    const filter = ['==', ['get', 'tool'], 'pin']
    for (const shape of MARKER_SHAPES) {
      for (const layer of markerLayers({ ...base, shape, filter })) {
        expect(layer.filter).toBe(filter)
      }
    }
  })

  it('sizes a disc glyph from its radius by default', () => {
    const [, glyph] = markerLayers({ ...base, shape: 'disc', radius: 12 })
    expect(glyph.layout?.['icon-size']).toBe(markerGlyphSizeForRadius(12))
  })

  it('draws a baked marker at its natural size by default', () => {
    // The image already IS the plate, so scaling it by the glyph ratio would
    // shrink the whole mark to the size of the glyph inside it.
    const [layer] = markerLayers({ ...base, shape: 'square' })
    expect(layer.layout?.['icon-size']).toBe(1)
  })
})

describe('marker image ids', () => {
  const spec = {
    shape: 'square' as const,
    pack: 'lucide' as const,
    name: 'Train',
    paint: { plate: '#cfe3ff', ink: '#123456', ring: '#0a1b2c' },
  }

  it('round-trip through the id, so the resolver can rebuild one', () => {
    expect(parseMarkerImageId(markerImageId(spec))).toEqual(spec)
  })

  it('ignores an id that is not ours', () => {
    expect(parseMarkerImageId('bm-lucide-MapPin')).toBeNull()
    expect(parseMarkerImageId('poi|badge-cafe|#fff|#000')).toBeNull()
  })

  it('survives a plateless glyph marker', () => {
    const bare = { ...spec, shape: 'glyph' as const, paint: { ...spec.paint, plate: null } }
    expect(parseMarkerImageId(markerImageId(bare))?.paint.plate).toBeNull()
  })

  it('gives two colours of the same glyph two ids', () => {
    const other = { ...spec, paint: { ...spec.paint, plate: '#ffd7d7' } }
    expect(markerImageId(spec)).not.toBe(markerImageId(other))
  })
})
