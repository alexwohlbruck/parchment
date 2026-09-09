import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TrackerMarker from './TrackerMarker.vue'
import { i18n } from '@/lib/i18n'
import type { LocationStaleness } from '@/types/multimodal.types'

/**
 * The pulse is the marker's claim that the vehicle is *there, now* — so what is
 * worth pinning down is which positions are allowed to make that claim. The
 * staleness bands themselves belong to the vehicles store; this only fixes
 * which of them pulse.
 */

const mountTracker = (staleness: LocationStaleness) =>
  mount(TrackerMarker, {
    props: {
      trackerId: 'v1',
      trackerName: 'Subaru',
      trackerType: 'car',
      staleness,
    },
    global: { plugins: [i18n] },
  })

const pulses = (staleness: LocationStaleness) =>
  mountTracker(staleness).find('.map-marker-pulse').exists()

describe('the pulse', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('claims the position while it is fresh', () => {
    expect(pulses('fresh')).toBe(true)
  })

  it('stops once the position is only aging, before it looks stale', () => {
    // Aging is under a day old: still drawn in full colour, but too old to
    // keep insisting the vehicle is there right now.
    expect(pulses('aging')).toBe(false)
  })

  it('never claims a position whose age is unknown', () => {
    expect(pulses('unknown')).toBe(false)
  })

  it('stays off once the position is stale', () => {
    expect(pulses('stale')).toBe(false)
    expect(pulses('very-stale')).toBe(false)
  })
})
