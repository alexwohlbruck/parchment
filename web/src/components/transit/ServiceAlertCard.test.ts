import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ServiceAlertCard from './ServiceAlertCard.vue'
import en from '@/lib/i18n/en-US.json'
import type { ServiceAlert } from '@/types/transit.types'

/**
 * Agencies write alerts to be read on a platform, and they write a lot of
 * them: stop lists, "listen to announcements on board", boilerplate about
 * arrival predictions. The card's job is to lead with the one line that
 * matters and keep the rest from pushing the departure board off screen.
 */

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': en },
})

function alert(overrides: Partial<ServiceAlert> = {}): ServiceAlert {
  return {
    id: 'feed_a1',
    feedId: 'feed',
    cause: 'CONSTRUCTION',
    effect: 'DETOUR',
    severity: 'WARNING',
    header: 'Southbound B48 buses are detoured',
    activePeriods: [],
    informedEntities: [{ routeId: 'B48' }],
    ...overrides,
  }
}

function render(a: ServiceAlert) {
  return mount(ServiceAlertCard, {
    props: { alert: a },
    global: { plugins: [i18n] },
  })
}

describe('ServiceAlertCard', () => {
  it('leads with the header and colours it by severity', () => {
    const w = render(alert({ severity: 'SEVERE', effect: 'NO_SERVICE' }))

    const heading = w.get('h3')
    expect(heading.text()).toBe('Southbound B48 buses are detoured')
    expect(heading.classes().join(' ')).toContain('text-red-600')
  })

  it('draws an unrated suspension as loudly as a rated one', () => {
    const w = render(alert({ severity: 'UNKNOWN_SEVERITY', effect: 'NO_SERVICE' }))

    expect(w.get('h3').classes().join(' ')).toContain('text-red-600')
  })

  it('clamps long prose behind an expand, and expands on click', async () => {
    const w = render(alert({ description: 'x'.repeat(400) }))

    expect(w.get('p').classes()).toContain('line-clamp-3')
    const toggle = w.get('button')
    expect(toggle.text()).toBe('Show more')

    await toggle.trigger('click')

    expect(w.get('p').classes()).not.toContain('line-clamp-3')
    expect(w.get('button').text()).toBe('Show less')
  })

  it('leaves a short note alone — no expand to press', () => {
    const w = render(alert({ description: 'Buses will not stop at Franklin Ave.' }))

    expect(w.get('p').classes()).not.toContain('line-clamp-3')
    expect(w.findAll('button')).toHaveLength(0)
  })

  it('says when the alert took effect, so a stale notice reads as one', () => {
    const start = new Date(Date.now() - 3 * 86_400_000)
    const w = render(alert({ activePeriods: [{ start: start.toISOString() }] }))

    expect(w.text()).toContain('In effect since')
  })

  it('prints no date for an open-ended alert rather than inventing one', () => {
    const w = render(alert({ activePeriods: [] }))

    expect(w.text()).not.toContain('In effect since')
  })

  it('prefers the agency posting time over the active window', () => {
    // MTA posts a detour weeks before the roadworks start; "posted 3 weeks ago"
    // and "in effect since tomorrow" say very different things about staleness.
    const w = render(
      alert({
        postedAt: new Date(Date.now() - 21 * 86_400_000).toISOString(),
        activePeriods: [{ start: new Date(Date.now() - 86_400_000).toISOString() }],
      }),
    )

    expect(w.text()).toContain('Posted')
    expect(w.text()).not.toContain('In effect since')
  })

  it('carries the agency\'s own category as a tooltip, untranslated', () => {
    const w = render(
      alert({ category: 'Planned - Detour', postedAt: new Date().toISOString() }),
    )

    expect(w.find('[title="Planned - Detour"]').exists()).toBe(true)
  })
})
