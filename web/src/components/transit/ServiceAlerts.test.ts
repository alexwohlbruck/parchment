import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import ServiceAlerts from './ServiceAlerts.vue'
import en from '@/lib/i18n/en-US.json'
import type { ServiceAlert } from '@/types/transit.types'

/**
 * The row of alerts on a line.
 *
 * A New York line carries a dozen at once and nearly all of them are scheduled
 * overnight work, so what this component gets right is *triage*: what is
 * happening now leads, everything else is reachable but out of the way, and
 * only the alert a rider taps opens up.
 */

const alerts: ServiceAlert[] = []

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(async () => ({ data: { alerts, feedTimestamps: {} } })) },
}))

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': en } })

const HOUR = 3_600_000

function alert(id: string, overrides: Partial<ServiceAlert> = {}): ServiceAlert {
  return {
    id,
    feedId: '5',
    cause: 'CONSTRUCTION',
    effect: 'DETOUR',
    severity: 'WARNING',
    header: `Headline for ${id}`,
    activePeriods: [],
    informedEntities: [{ routeId: '7' }],
    ...overrides,
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

/** In effect right now, with hours still to run. */
const live = (id: string, extra: Partial<ServiceAlert> = {}) =>
  alert(id, {
    activePeriods: [{ start: iso(Date.now() - HOUR), end: iso(Date.now() + 4 * HOUR) }],
    ...extra,
  })

/** Scheduled: a window that already ran, and another later tonight. */
const scheduled = (id: string, hoursOut = 4) =>
  alert(id, {
    activePeriods: [
      { start: iso(Date.now() - 48 * HOUR), end: iso(Date.now() - 44 * HOUR) },
      { start: iso(Date.now() + hoursOut * HOUR), end: iso(Date.now() + (hoursOut + 4) * HOUR) },
    ],
  })

async function render() {
  const w = mount(ServiceAlerts, {
    props: { query: { feedId: '5', routeIds: ['7'], includeUpcoming: true }, title: 'Alerts on this line' },
    global: { plugins: [i18n, createPinia()] },
  })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  alerts.length = 0
})

describe('ServiceAlerts', () => {
  it('renders nothing at all when a line is clear', async () => {
    const w = await render()

    expect(w.find('section').exists()).toBe(false)
  })

  it('puts what is happening now ahead of scheduled work', async () => {
    alerts.push(scheduled('tonight'), live('now'))

    const w = await render()
    const chips = w.findAll('button')

    expect(chips[0].text()).toContain('Headline for now')
    expect(chips[1].text()).toContain('Headline for tonight')
  })

  it('says which of them are live and which are scheduled', async () => {
    alerts.push(live('a'), scheduled('b'), scheduled('c'))

    const w = await render()

    expect(w.text()).toContain('1 now · 2 scheduled')
  })

  it('marks a live alert "Now" and a scheduled one with when it starts', async () => {
    alerts.push(live('a'), scheduled('b'))

    const w = await render()
    const chips = w.findAll('button')

    expect(chips[0].text()).toContain('Now')
    expect(chips[1].text()).not.toContain('Now')
  })

  it('says when something nearly over lifts, rather than "Now"', async () => {
    // "Now" on a window with ten minutes left tells a rider to give up on a
    // train that is about to start running normally again.
    alerts.push(
      alert('ending', {
        activePeriods: [{ start: iso(Date.now() - HOUR), end: iso(Date.now() + 10 * 60_000) }],
      }),
    )

    const w = await render()

    expect(w.findAll('button')[0].text()).toContain('Until')
  })

  it('opens only the alert that was tapped, and closes it again', async () => {
    alerts.push(live('a'), live('b'))

    const w = await render()
    // Nothing is expanded to start with — the row is the whole of it.
    expect(w.find('article').exists()).toBe(false)

    await w.findAll('button')[0].trigger('click')
    expect(w.find('article').text()).toContain('Headline for a')

    await w.findAll('button')[0].trigger('click')
    expect(w.find('article').exists()).toBe(false)
  })

  it('swaps the open alert rather than stacking a second one', async () => {
    alerts.push(live('a'), live('b'))

    const w = await render()
    await w.findAll('button')[0].trigger('click')
    await w.findAll('button')[1].trigger('click')

    expect(w.findAll('article')).toHaveLength(1)
    expect(w.find('article').text()).toContain('Headline for b')
  })

  it('scrolls horizontally rather than stacking down the page', async () => {
    alerts.push(live('a'), live('b'), live('c'))

    const w = await render()
    const row = w.find('[data-testid="alert-row"]')

    expect(row.exists()).toBe(true)
    expect(row.classes()).toContain('overflow-x-auto')
    // Runs to the panel edge rather than sitting inside its padding.
    expect(w.find('.edge-bleed').exists()).toBe(true)
    expect(w.findAll('button')).toHaveLength(3)
  })
})
