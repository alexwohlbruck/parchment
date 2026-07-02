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
