import { describe, test, expect } from 'vitest'
import { belowLabelsBeforeId, belowRoadsBeforeId, slotBeforeId } from './layer-slots'

/**
 * Both halves shipped wrong. The cycling lanes drew over the POI names and
 * over the train lines that are supposed to cross above them, and the route
 * corridor drew over the roads — where, being translucent, it blotted at
 * every junction because MapLibre blends each feature on its own.
 */
describe('where an overlay slots into the basemap', () => {
  const STYLE = [
    { id: 'Background', type: 'background' },
    { id: 'Residential', type: 'fill' },
    { id: 'Water', type: 'fill' },
    { id: 'River', type: 'line' },
    { id: 'Minor road outline', type: 'line' },
    { id: 'Minor road', type: 'line' },
    { id: 'Building', type: 'fill' },
    { id: 'Oneway', type: 'symbol' },
    { id: 'Road labels', type: 'symbol' },
  ]

  test('bottom lands above the polygons and below the first stroke', () => {
    expect(belowRoadsBeforeId(STYLE)).toBe('River')
  })

  test('middle lands below the first label', () => {
    expect(belowLabelsBeforeId(STYLE)).toBe('Oneway')
  })

  test('the transit network ends the ground sooner than the labels do', () => {
    const withTransit = [
      ...STYLE.slice(0, 6),
      { id: 'portolan-ribbon-14-steady', type: 'line' },
      ...STYLE.slice(6),
    ]
    expect(belowLabelsBeforeId(withTransit)).toBe('portolan-ribbon-14-steady')
  })

  /**
   * The overlay's own layers must not stand in for the basemap's. A
   * `portolan-` line is not the basemap's first road, and treating it as one
   * would drop a corridor beneath a style that has not drawn its roads yet.
   */
  test('an overlay stroke is not mistaken for the first road', () => {
    const layers = [
      { id: 'Residential', type: 'fill' },
      { id: 'portolan-ribbon-14-steady', type: 'line' },
      { id: 'Minor road', type: 'line' },
    ]
    expect(belowRoadsBeforeId(layers)).toBe('Minor road')
  })

  test('an overlay label is not mistaken for a basemap one', () => {
    const layers = [
      { id: 'Minor road', type: 'line' },
      { id: 'portolan-station-labels', type: 'symbol' },
    ]
    expect(belowLabelsBeforeId(layers)).toBe('portolan-station-labels')
  })

  /**
   * The basemap draws a path bridge over every road and a tunnel under them
   * all, so which band a mark lands in is what says whether the way it marks
   * crosses over, along, or under. Read off the filters: `Path` names both
   * brunnels to exclude them, so mentioning one proves nothing.
   */
  describe('the bands the basemap draws its brunnels in', () => {
    /** As the basemap serves them: a source, and a filter naming the brunnel. */
    const road = (id: string, type: string, filter?: unknown) => ({
      id,
      type,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      ...(filter ? { filter } : {}),
    })
    const BRUNNEL_STYLE = [
      { id: 'Background', type: 'background' },
      { id: 'Water', type: 'fill', source: 'openmaptiles' },
      road('Footway tunnel', 'line', [
        'all',
        ['in', 'class', 'path'],
        ['==', 'brunnel', 'tunnel'],
      ]),
      road('Pier', 'line', ['==', 'class', 'pier']),
      road('Path', 'line', [
        'all',
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['!=', ['get', 'brunnel'], 'bridge'],
      ]),
      road('Minor road', 'line', ['!=', 'brunnel', 'tunnel']),
      road('Oneway', 'symbol'),
      road('Path bridge', 'line', [
        'any',
        ['==', ['get', 'brunnel'], 'bridge'],
        ['>', ['get', 'layer'], 0],
      ]),
      { id: 'Building', type: 'fill', source: 'openmaptiles' },
      { id: 'Road labels', type: 'symbol', source: 'openmaptiles' },
    ]

    test('bridge clears the decks, and the arrows drawn under them', () => {
      expect(slotBeforeId(BRUNNEL_STYLE, 'bridge')).toBe('Building')
    })

    test('tunnel lands between the tunnels and the surface', () => {
      expect(slotBeforeId(BRUNNEL_STYLE, 'tunnel')).toBe('Pier')
    })

    test('the slots stack in the order they name', () => {
      const at = (slot: string) =>
        BRUNNEL_STYLE.findIndex(l => l.id === slotBeforeId(BRUNNEL_STYLE, slot))
      expect(at('bottom')).toBeLessThan(at('tunnel'))
      expect(at('tunnel')).toBeLessThan(at('middle'))
      expect(at('middle')).toBeLessThan(at('bridge'))
    })

    /**
     * An anchor is a position and overlays are inserted at it, so the bridge
     * band has to name a layer of the basemap's: one answering `whatever sits
     * here now` would name the mark added last and stack the rest in reverse.
     */
    test('a second mark on a deck stacks above the first', () => {
      const stack = [...BRUNNEL_STYLE]
      for (const id of ['bicycle-cycleways-bridge', 'bicycle-paths-bridge']) {
        const before = slotBeforeId(stack, 'bridge')
        stack.splice(stack.findIndex(l => l.id === before), 0, {
          id,
          type: 'line',
          source: 'bicycle-ways',
        } as any)
      }
      expect(stack.findIndex(l => l.id === 'bicycle-cycleways-bridge'))
        .toBeLessThan(stack.findIndex(l => l.id === 'bicycle-paths-bridge'))
    })

    /** A mark on a tunnel goes above the basemap's, not under it. */
    test('a tunnel already marked keeps the next mark above it', () => {
      const marked = [
        ...BRUNNEL_STYLE.slice(0, 3),
        {
          id: 'bicycle-cycleways-tunnel',
          type: 'line',
          source: 'bicycle-ways',
          'source-layer': 'bicycle_ways',
          filter: ['==', 'tunnel', true],
        },
        ...BRUNNEL_STYLE.slice(3),
      ]
      expect(slotBeforeId(marked, 'tunnel')).toBe('Pier')
    })

    /** A style with no bridges of its own still has to put a mark somewhere. */
    test('without a band to find, both fall back to a slot that exists', () => {
      const bare = [
        { id: 'Minor road', type: 'line', source: 'openmaptiles' },
        { id: 'Road labels', type: 'symbol', source: 'openmaptiles' },
      ]
      expect(slotBeforeId(bare, 'bridge')).toBe('Road labels')
      expect(slotBeforeId(bare, 'tunnel')).toBe('Minor road')
    })
  })

  test('a style with nothing to anchor against draws on top', () => {
    expect(belowRoadsBeforeId([{ id: 'Background', type: 'background' }])).toBeUndefined()
    expect(belowLabelsBeforeId([{ id: 'Minor road', type: 'line' }])).toBeUndefined()
  })

  test('top and an unnamed slot stay on top, where they already are', () => {
    expect(slotBeforeId(STYLE, 'bottom')).toBe('River')
    expect(slotBeforeId(STYLE, 'middle')).toBe('Oneway')
    expect(slotBeforeId(STYLE, 'top')).toBeUndefined()
    expect(slotBeforeId(STYLE, undefined)).toBeUndefined()
  })

  /** The slots stack in the order they name. */
  test('bottom is below middle', () => {
    const at = (id: string | undefined) => STYLE.findIndex(l => l.id === id)
    expect(at(slotBeforeId(STYLE, 'bottom'))).toBeLessThan(at(slotBeforeId(STYLE, 'middle')))
  })
})
