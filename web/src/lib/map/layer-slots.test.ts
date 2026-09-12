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
