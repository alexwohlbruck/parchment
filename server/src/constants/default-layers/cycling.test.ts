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

  /**
   * Ground, and which band of it: the basemap draws a bridge deck over the
   * whole network and a tunnel under it, and redraws the way over anything
   * painted in the wrong band.
   */
  const asks = (t: any, clause: string) =>
    JSON.stringify(t.configuration.filter).includes(clause)

  test('a way is drawn in the band its brunnel puts it in', () => {
    for (const t of lines) {
      const slot = asks(t, '["==","bridge",true]')
        ? 'bridge'
        : asks(t, '["==","tunnel",true]')
          ? 'tunnel'
          : asks(t, '["!=","bridge",true]')
            ? 'grade'
            : 'middle'
      expect(t.configuration.slot, t.templateId).toBe(slot)
    }
  })

  /** Drawn in two bands, a way is painted twice — once in the wrong place. */
  test('the surface layers leave the bridges and tunnels alone', () => {
    const banded = lines.filter(t => ['bridge', 'tunnel'].includes(t.configuration.slot))
    expect(banded.length).toBe(4)
    for (const t of banded) {
      const surface = lines.filter(
        s => s.groupId === t.groupId && s.configuration.slot === 'grade',
      )
      expect(surface.length, t.templateId).toBeGreaterThan(0)
      for (const s of surface) {
        expect(asks(s, '["!=","bridge",true]'), s.templateId).toBe(true)
        expect(asks(s, '["!=","tunnel",true]'), s.templateId).toBe(true)
      }
    }
  })

  /**
   * The basemap has already cased the way on its deck and in its bore. A second
   * casing over either rubs out the crossing the mark is drawn on.
   */
  test('a deck and a bore carry the stroke alone', () => {
    for (const t of lines.filter(t => ['bridge', 'tunnel'].includes(t.configuration.slot))) {
      expect(t.configuration.id, t.templateId).not.toContain('casing')
      expect(t.configuration.paint['line-dasharray'], t.templateId).toBeUndefined()
    }
  })

  /** Translucency compounds wherever two ways overlap; see `layer-slots.ts`. */
  test('nothing is translucent', () => {
    for (const t of lines) {
      const opacity = t.configuration.paint['line-opacity']
      expect(opacity === undefined || opacity === 1).toBe(true)
    }
  })

  /**
   * Off-street ways say their surface the way Google and OpenCycleMap do:
   * solid where it is hard, dashed where it is not. The on-street dash grammar
   * never appears here, so a dash can only mean one thing in each family.
   */
  test.each([
    ['bicycle-cycleways', 'bicycle-cycleways-unpaved'],
    ['bicycle-paths', 'bicycle-paths-unpaved'],
  ])('%s draws solid and %s dashed', (paved, unpaved) => {
    const of = (id: string) =>
      lines.find(t => t.configuration.id === id)!.configuration
    expect(of(paved).paint['line-dasharray']).toBeUndefined()
    expect(of(unpaved).paint['line-dasharray']).toBeDefined()
    // Same colour and width — only the surface differs.
    expect(of(paved).paint['line-color']).toEqual(of(unpaved).paint['line-color'])
    expect(of(paved).paint['line-width']).toEqual(of(unpaved).paint['line-width'])
  })

  /** What you cannot ride yet must not look like what you can. */
  test('proposed and construction leave more gap than mark', () => {
    for (const id of ['bicycle-proposed', 'bicycle-construction']) {
      const dash = lines.find(t => t.configuration.id === id)!.configuration.paint[
        'line-dasharray'
      ]
      expect(dash[1] / dash[0], id).toBeGreaterThanOrEqual(1)
    }
  })

  /** Amber is the roadworks convention, and the only warm mark in the set. */
  test('construction is the one thing that is not green', () => {
    const hue = (id: string) => {
      const c = lines.find(t => t.configuration.id === id)!.configuration.paint[
        'line-color'
      ]
      return Number(/hsl\(\s*([\d.]+)/.exec(c[c.length - 1])![1])
    }
    expect(hue('bicycle-construction')).toBeLessThan(60)
    for (const id of ['bicycle-cycleways', 'bicycle-paths', 'bicycle-routes']) {
      expect(hue(id), id).toBeGreaterThan(140)
    }
  })

  /**
   * The one place two layers may describe the same street is the zoom where
   * one hands over to the other. A signed route drawn on top of the lanes it
   * follows is a third green line claiming the middle of a street whose sides
   * are already marked.
   */
  test('the signed route hands over to the infrastructure at z12', () => {
    const route = lines.find(t => t.configuration.id === 'bicycle-routes')!
    expect(route.configuration.maxzoom).toBe(12)
    expect(route.configuration.minzoom).toBeLessThan(12)
  })

  /** Past the handover the route's name is what says it is signed. */
  test('route labels draw past the handover, at every zoom', () => {
    const labels = CYCLING_LAYER_TEMPLATES.find(
      t => t.configuration.type === 'symbol',
    )!
    expect(labels.configuration.maxzoom).toBeUndefined()
    expect(labels.configuration.minzoom).toBeGreaterThanOrEqual(10)
  })

  /** House style, and mixed case is what the basemap letters streets in. */
  test('route names are not set in capitals', () => {
    const labels = CYCLING_LAYER_TEMPLATES.find(
      t => t.configuration.type === 'symbol',
    )!
    expect(labels.configuration.layout['text-transform']).toBeUndefined()
  })

  /**
   * MapLibre reads a filter as legacy OR as an expression, never both, and a
   * mixed one fails at style load — the layer simply never draws, with nothing
   * on the map to say so. That is how the paved/unpaved split shipped invisible.
   *
   * The tell is the operand: legacy names a property with a bare string,
   * an expression wraps it in `["get", …]`.
   */
  test.each(CYCLING_LAYER_TEMPLATES.map(t => [t.templateId, t]))(
    '%s: the filter speaks one syntax',
    (_id, t: any) => {
      const OPS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in', '!in', 'has', '!has'])
      const seen = new Set<string>()
      const walk = (f: any) => {
        if (!Array.isArray(f)) return
        if (OPS.has(f[0])) seen.add(typeof f[1] === 'string' ? 'legacy' : 'expression')
        f.forEach(walk)
      }
      walk(t.configuration.filter)
      expect([...seen].sort(), `${t.templateId} mixes syntaxes`).not.toEqual([
        'expression',
        'legacy',
      ])
    },
  )

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
