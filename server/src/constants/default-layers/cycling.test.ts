import { describe, test, expect } from 'bun:test'
import { CYCLING_LAYER_TEMPLATES } from './cycling'
import { DEFAULT_LAYER_GROUPS } from './groups'

/**
 * The wiring between a cycling template and where it lands on the map.
 *
 * Both halves of this shipped wrong: the lanes drew over the place names
 * because nothing told the map they were ground, and the signed-route corridor
 * drew over the roads, where being translucent it blotted at every junction.
 * Neither is visible in a layer config read on its own — only in what the
 * config claims about its band.
 */
describe('cycling layers claim a band', () => {
  const lines = CYCLING_LAYER_TEMPLATES.filter(
    t => t.configuration.type === 'line',
  )

  test('there are line layers to check', () => {
    expect(lines.length).toBeGreaterThan(4)
  })

  test.each(lines.map(t => [t.templateId, t]))(
    '%s: is ground, not something drawn over the map',
    (_id, t: any) => {
      expect(['bottom', 'middle']).toContain(t.configuration.slot)
    },
  )

  /**
   * A translucent line cannot go above the roads: MapLibre blends each
   * feature on its own, so two that overlap — a corner, a junction, two
   * routes sharing a street — compound into a dark blot. Anything in the
   * `middle` band has to be opaque.
   */
  test.each(lines.map(t => [t.templateId, t]))(
    '%s: is opaque unless it sits below the roads',
    (_id, t: any) => {
      const opacity = t.configuration.paint['line-opacity']
      if (t.configuration.slot === 'bottom') return
      expect(opacity === undefined || opacity === 1).toBe(true)
    },
  )

  test('the signed-route corridor is the one that goes under the roads', () => {
    const corridor = lines.find(t => t.templateId === 'default:bicycle-routes')!
    expect(corridor.configuration.slot).toBe('bottom')
    // Wider than the street it follows, or no verge shows either side of it.
    const stops = corridor.configuration.paint['line-width'].slice(3)
    expect(Math.max(...stops.filter((_: number, i: number) => i % 2 === 1))).toBeGreaterThan(12)
  })

  /**
   * Ways that ARE cycling infrastructure are the basemap's job now — it
   * repaints the road surface green at exactly that road's width. Drawing
   * them here as well doubles them.
   */
  test('the basemap draws the designated ways, not these layers', () => {
    const group = DEFAULT_LAYER_GROUPS.find(
      g => g.templateId === 'default:group:cycling',
    )!
    expect(group.basemapGroup).toBe('cycling')
    const filters = JSON.stringify(lines.map(t => t.configuration.filter))
    expect(filters).not.toContain('bicycle_designated')
    expect(filters).not.toContain('cycleway')
  })

  /** Under transit: where the two cross, the train passes over the bike lane. */
  test('cycling sorts below transit', () => {
    const order = (id: string) =>
      DEFAULT_LAYER_GROUPS.find(g => g.templateId === id)!.order
    expect(order('default:group:cycling')).toBeGreaterThan(order('default:group:transit'))
  })
})
