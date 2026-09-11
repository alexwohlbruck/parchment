import { describe, test, expect } from 'bun:test'
import { CYCLING_LAYER_TEMPLATES } from './cycling'
import { DEFAULT_LAYER_GROUPS } from './groups'

/**
 * Which half of the network a way belongs to is the whole design: a road
 * MARKED for bikes is painted as a road, by the basemap; a way BUILT for bikes
 * keeps its own cased mark, drawn here. Drawing a way in both halves doubles
 * it, and drawing it in neither loses it.
 */
describe('cycling defaults', () => {
  const lines = CYCLING_LAYER_TEMPLATES.filter(t => t.configuration.type === 'line')
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

  test('dedicated ways keep a mark of their own', () => {
    for (const id of ['bicycle-cycleways', 'bicycle-paths', 'bicycle-routes']) {
      expect(lines.map(t => t.configuration.id)).toContain(id)
    }
  })

  /**
   * Provision on a road is the basemap's tint. If one of these drew it too,
   * every bike lane would carry both a green street and a line down it.
   */
  test('nothing here redraws what the basemap tints', () => {
    const filters = JSON.stringify(lines.map(t => t.configuration.filter))
    for (const onStreet of ['cycle_lane', 'shared_lane', 'cycle_track', 'bicycle_road']) {
      expect(filters, onStreet).not.toContain(onStreet)
    }
  })

  test('everything is ground, above the roads and below the labels', () => {
    for (const t of lines) expect(t.configuration.slot).toBe('middle')
  })

  /** Translucency compounds wherever two ways overlap; see `layer-slots.ts`. */
  test('nothing is translucent', () => {
    for (const t of lines) {
      const opacity = t.configuration.paint['line-opacity']
      expect(opacity === undefined || opacity === 1).toBe(true)
    }
  })

  test('every cycling group owns a layer or the basemap behind it', () => {
    const groups = DEFAULT_LAYER_GROUPS.filter(g =>
      g.templateId.startsWith('default:group:cycling'),
    )
    for (const g of groups) {
      const owns = CYCLING_LAYER_TEMPLATES.some(t => t.groupId === g.templateId)
      expect(owns || Boolean(g.basemapGroup), g.templateId).toBe(true)
    }
  })
})
