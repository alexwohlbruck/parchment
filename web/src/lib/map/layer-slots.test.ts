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

    test('middle clears the bridges, and the arrows drawn under them', () => {
      expect(belowLabelsBeforeId(BRUNNEL_STYLE)).toBe('Building')
    })

    test('tunnel lands between the tunnels and the surface', () => {
      expect(slotBeforeId(BRUNNEL_STYLE, 'tunnel')).toBe('Pier')
    })

    test('the slots stack in the order they name', () => {
      const at = (id: string | undefined) => BRUNNEL_STYLE.findIndex(l => l.id === id)
      expect(at(slotBeforeId(BRUNNEL_STYLE, 'bottom')))
        .toBeLessThan(at(slotBeforeId(BRUNNEL_STYLE, 'tunnel')))
      expect(at(slotBeforeId(BRUNNEL_STYLE, 'tunnel')))
        .toBeLessThan(at(slotBeforeId(BRUNNEL_STYLE, 'middle')))
    })

    /**
     * An anchor is a position, and overlays are inserted at it — so it has to
     * name a layer of the basemap's, or the second mark added lands under the
     * first and a casing covers the stroke it is supposed to edge.
     */
    test('a second mark stacks above the first, not under it', () => {
      const stack = [...BRUNNEL_STYLE]
      for (const id of ['bicycle-cycleways-casing', 'bicycle-cycleways']) {
        const before = slotBeforeId(stack, 'middle')
        stack.splice(stack.findIndex(l => l.id === before), 0, {
          id,
          type: 'line',
          source: 'bicycle-ways',
        } as any)
      }
      expect(stack.findIndex(l => l.id === 'bicycle-cycleways-casing'))
        .toBeLessThan(stack.findIndex(l => l.id === 'bicycle-cycleways'))
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

    test('the transit network still ends the ground first', () => {
      const withTransit = [
        ...BRUNNEL_STYLE.slice(0, 6),
        { id: 'portolan-ribbon-14-steady', type: 'line' },
        ...BRUNNEL_STYLE.slice(6),
      ]
      expect(belowLabelsBeforeId(withTransit)).toBe('portolan-ribbon-14-steady')
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
