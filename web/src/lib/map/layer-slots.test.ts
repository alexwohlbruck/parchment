import { describe, test, expect } from 'vitest'
import { groundBeforeId, slotBeforeId } from './layer-slots'

/**
 * The rule: ground draws under the labels AND under the transit network.
 * Both halves shipped wrong — the cycling lanes went over the POI names, and
 * over the train lines that are supposed to cross above them.
 */
describe('where a ground layer slots in', () => {
  const STYLE = [
    { id: 'Background', type: 'background' },
    { id: 'Minor road', type: 'line' },
    { id: 'Building', type: 'fill' },
    { id: 'Oneway', type: 'symbol' },
    { id: 'Road labels', type: 'symbol' },
    { id: 'Food', type: 'symbol' },
  ]

  test('ground stops at the first label', () => {
    expect(groundBeforeId(STYLE)).toBe('Oneway')
  })

  test('the transit network ends it sooner', () => {
    const withTransit = [
      ...STYLE.slice(0, 3),
      { id: 'portolan-ribbon-14-steady', type: 'line' },
      ...STYLE.slice(3),
    ]
    expect(groundBeforeId(withTransit)).toBe('portolan-ribbon-14-steady')
  })

  /**
   * The transit overlay inserts its own labels above the basemap's, so a
   * `portolan-` symbol must not be mistaken for the basemap's first label —
   * that would anchor ground above the ribbons instead of below them.
   */
  test('an overlay label does not stand in for a basemap one', () => {
    const layers = [
      { id: 'Minor road', type: 'line' },
      { id: 'portolan-station-labels', type: 'symbol' },
    ]
    expect(groundBeforeId(layers)).toBe('portolan-station-labels')
  })

  test('a style that is all ground has no anchor, so the layer goes on top', () => {
    expect(groundBeforeId([{ id: 'Minor road', type: 'line' }])).toBeUndefined()
  })

  /**
   * Only `bottom` is emulated. Anything else already means "above the
   * basemap" on MapLibre, which is where an unanchored layer lands — giving
   * those an anchor would move layers that are correct today.
   */
  test('only the ground slot resolves to an anchor', () => {
    expect(slotBeforeId(STYLE, 'bottom')).toBe('Oneway')
    expect(slotBeforeId(STYLE, 'middle')).toBeUndefined()
    expect(slotBeforeId(STYLE, 'top')).toBeUndefined()
    expect(slotBeforeId(STYLE, undefined)).toBeUndefined()
  })
})
