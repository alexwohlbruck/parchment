import { describe, test, expect } from 'bun:test'
import { CYCLING_LAYER_TEMPLATES } from './cycling'
import { DEFAULT_LAYER_GROUPS } from './groups'

/**
 * The network is the basemap's job now: it repaints each road's own surface at
 * that road's own width. These guard the wiring that makes that happen, and
 * the absence of the line layers it replaced — drawing both would double every
 * bike lane on the map.
 */
describe('cycling defaults', () => {
  const group = DEFAULT_LAYER_GROUPS.find(
    g => g.templateId === 'default:group:cycling',
  )!

  test('the group switches on the basemap tint', () => {
    expect(group.basemapGroup).toBe('cycling')
  })

  /** Under transit: where the two cross, the train passes over the bike lane. */
  test('cycling sorts below transit', () => {
    const order = (id: string) =>
      DEFAULT_LAYER_GROUPS.find(g => g.templateId === id)!.order
    expect(order('default:group:cycling')).toBeGreaterThan(
      order('default:group:transit'),
    )
  })

  test('nothing here draws the network as a line over the road', () => {
    const lines = CYCLING_LAYER_TEMPLATES.filter(
      t => t.configuration.type === 'line',
    )
    expect(lines).toEqual([])
  })

  /**
   * The name of a signed route belongs to a relation, not to any road, so it
   * is the one thing the basemap cannot say and the one thing left here.
   */
  test('signed routes keep their labels', () => {
    expect(CYCLING_LAYER_TEMPLATES).toHaveLength(1)
    const labels = CYCLING_LAYER_TEMPLATES[0]
    expect(labels.configuration.type).toBe('symbol')
    expect(labels.configuration['source-layer']).toBe('bicycle_routes')
  })

  test('every group left still has a layer or the basemap behind it', () => {
    const cycling = DEFAULT_LAYER_GROUPS.filter(g =>
      g.templateId.startsWith('default:group:cycling'),
    )
    for (const g of cycling) {
      const owns = CYCLING_LAYER_TEMPLATES.some(t => t.groupId === g.templateId)
      expect(owns || Boolean(g.basemapGroup), g.templateId).toBe(true)
    }
  })
})
