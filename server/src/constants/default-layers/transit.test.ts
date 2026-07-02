import { describe, expect, test } from 'bun:test'
import { TRANSIT_LAYER_TEMPLATES } from './transit'

/**
 * Guards the v3 two-layer render model for the bundled ribbons
 * (transit_lines_rt2: kind='steady' constant offset_px, kind='transition'
 * off_from_px→off_to_px eased along line-progress). See
 * docs/par-12-client-render.md.
 */

const byId = (id: string) =>
  TRANSIT_LAYER_TEMPLATES.find(t => t.configuration.id === id)

const STEADY_IDS = ['transit-lines-casing-steady', 'transit-lines-steady']
const TRANSITION_IDS = [
  'transit-lines-casing-transition',
  'transit-lines-transition',
]

const TRANSITION_OFFSET_EXPR = [
  'interpolate',
  ['cubic-bezier', 0.4, 0, 0.6, 1],
  ['line-progress'],
  0, ['get', 'off_from_px'],
  1, ['get', 'off_to_px'],
]

describe('transit v3 bundled ribbon templates', () => {
  test('ribbon layers ride the transit_lines_rt2 source', () => {
    for (const id of [...STEADY_IDS, ...TRANSITION_IDS]) {
      const tiles = byId(id)?.configuration.source?.tiles?.[0] ?? ''
      expect(tiles).toContain('/barrelman/transit_lines_rt2/')
      expect(byId(id)?.configuration['source-layer']).toBe('transit_lines')
    }
  })

  test('steady layers: kind filter + raw offset_px line-offset', () => {
    for (const id of STEADY_IDS) {
      const config = byId(id)?.configuration
      expect(config?.filter).toEqual(['==', ['get', 'kind'], 'steady'])
      expect(config?.paint['line-offset']).toEqual(['get', 'offset_px'])
    }
  })

  test('transition layers: kind filter + line-progress interpolation', () => {
    for (const id of TRANSITION_IDS) {
      const config = byId(id)?.configuration
      expect(config?.filter).toEqual(['==', ['get', 'kind'], 'transition'])
      expect(config?.paint['line-offset']).toEqual(TRANSITION_OFFSET_EXPR)
    }
  })

  test('steady/transition pairs share colour and width paint', () => {
    for (const [steadyId, transitionId] of [
      ['transit-lines-casing-steady', 'transit-lines-casing-transition'],
      ['transit-lines-steady', 'transit-lines-transition'],
    ]) {
      const steady = byId(steadyId)?.configuration.paint
      const transition = byId(transitionId)?.configuration.paint
      expect(transition['line-color']).toEqual(steady['line-color'])
      expect(transition['line-width']).toEqual(steady['line-width'])
    }
  })

  test('route bullets stay defined but never render (v3 carrier pending)', () => {
    const bullets = byId('transit-lines-bullets')
    expect(bullets).toBeDefined()
    expect(bullets?.visible).toBe(false)
    expect(bullets?.configuration.filter).toEqual(['boolean', false])
  })
})

/**
 * Guards the mode partition consumed by the client's rail/bus/ferry filter:
 * every display layer carries exactly one `metadata.transitMode`, and no
 * layer's route_type filter straddles two modes (the mode toggles flip layer
 * visibility, so a mixed layer could not be filtered per mode).
 */
describe('transit mode partition (rail / bus / ferry)', () => {
  const BUS_IDS = ['transit-routes-bus', 'transit-stops-bus']
  const FERRY_IDS = [
    'transit-routes-ferry-casing',
    'transit-routes-ferry',
    'transit-routes-ferry-hover',
    'transit-route-labels-ferry',
  ]

  test('every template declares a known transitMode', () => {
    for (const template of TRANSIT_LAYER_TEMPLATES) {
      expect(['rail', 'bus', 'ferry']).toContain(
        template.configuration.metadata?.transitMode,
      )
    }
  })

  test('bus and ferry membership is exactly the expected layer sets', () => {
    const byMode = (mode: string) =>
      TRANSIT_LAYER_TEMPLATES.filter(
        t => t.configuration.metadata?.transitMode === mode,
      ).map(t => t.configuration.id)
    expect(byMode('bus').sort()).toEqual([...BUS_IDS].sort())
    expect(byMode('ferry').sort()).toEqual([...FERRY_IDS].sort())
    // Everything else is rail (ribbons, rail routes, stations, infra glyphs).
    expect(byMode('rail').length).toBe(
      TRANSIT_LAYER_TEMPLATES.length - BUS_IDS.length - FERRY_IDS.length,
    )
  })

  test('transit_routes filters keep the modes disjoint', () => {
    const RAIL_FILTER = ['match', ['get', 'route_type'], [3, 4, 11], false, true]
    const FERRY_FILTER = ['match', ['get', 'route_type'], [4], true, false]
    for (const id of [
      'transit-routes-casing',
      'transit-routes-line',
      'transit-routes-hover',
      'transit-route-labels',
    ]) {
      expect(byId(id)?.configuration.filter).toEqual(RAIL_FILTER)
    }
    for (const id of FERRY_IDS) {
      expect(byId(id)?.configuration.filter).toEqual(FERRY_FILTER)
    }
  })

  test('ferry layers mirror their rail counterparts (paint parity)', () => {
    for (const [ferryId, railId] of [
      ['transit-routes-ferry-casing', 'transit-routes-casing'],
      ['transit-routes-ferry', 'transit-routes-line'],
      ['transit-routes-ferry-hover', 'transit-routes-hover'],
      ['transit-route-labels-ferry', 'transit-route-labels'],
    ]) {
      const ferry = byId(ferryId)?.configuration
      const rail = byId(railId)?.configuration
      expect(ferry?.paint).toEqual(rail?.paint)
      expect(ferry?.type).toBe(rail?.type)
    }
  })

  test('the station query layer (DOM marker feed) rides the rail toggle', () => {
    expect(
      byId('transit-stations-query')?.configuration.metadata?.transitMode,
    ).toBe('rail')
  })
})
