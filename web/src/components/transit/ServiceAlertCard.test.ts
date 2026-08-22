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

    const heading = w.get('[data-testid="alert-header"]')
    expect(heading.text()).toBe('Southbound B48 buses are detoured')
    expect(heading.classes().join(' ')).toContain('text-red-600')
  })

  it('draws an unrated suspension as loudly as a rated one', () => {
    const w = render(alert({ severity: 'UNKNOWN_SEVERITY', effect: 'NO_SERVICE' }))

    expect(w.get('[data-testid="alert-header"]').classes().join(' ')).toContain('text-red-600')
  })

  it('shows the whole of the prose — this is the expansion', () => {
    // The chip clamped it to two lines; opening one is the rider asking for
    // the rest, so nothing here is hidden behind a second tap.
    const prose = 'x'.repeat(400)
    const w = render(alert({ description: prose }))

    expect(w.get('p').text()).toBe(prose)
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

  it('names the year on a date from a previous one', () => {
    // MTA's long-running work carries posting dates from previous years, and
    // a bare "Posted Dec 1" reads as a fortnight ago.
    const lastYear = new Date()
    lastYear.setFullYear(lastYear.getFullYear() - 1)
    const w = render(alert({ postedAt: lastYear.toISOString() }))

    expect(w.text()).toContain(String(lastYear.getFullYear()))
  })

  it('leaves the year off a date from this year', () => {
    const w = render(alert({ postedAt: new Date().toISOString() }))

    expect(w.text()).not.toContain(String(new Date().getFullYear()))
  })

  it("shows the agency's own category, which says whether they planned it", () => {
    // "Detour" is our word for the effect; "Planned - Detour" is theirs, and
    // the qualifier is the part our label cannot carry. It was tooltip-only.
    const w = render(
      alert({ category: 'Planned - Detour', postedAt: new Date().toISOString() }),
    )

    expect(w.text()).toContain('Planned - Detour')
  })
})
