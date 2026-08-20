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
  /** The disclosure line, and the chips it hides. */
  const disclosure = (w: any) => w.find('[data-testid="scheduled-toggle"]')
  const chips = (w: any) => w.findAll('[data-testid="alert-row"] button')
  const rows = (w: any) => w.findAll('[aria-expanded]').filter(
    (b: any) => b.attributes('data-testid') !== 'scheduled-toggle',
  )

  it('renders nothing at all when a line is clear', async () => {
    const w = await render()

    expect(w.find('section').exists()).toBe(false)
  })

  it('shows no alert surfaces at all when only scheduled work exists', async () => {
    // The common case on a working line: a dozen overnight closures and
    // nothing running wrong. The page should not look alarmed.
    alerts.push(scheduled('a'), scheduled('b'))

    const w = await render()

    expect(rows(w)).toHaveLength(0)
    expect(disclosure(w).text()).toContain('2 scheduled changes')
    // Folded away until asked for.
    expect(chips(w)).toHaveLength(0)
  })

  it('gives what is in effect a full-width row, not a chip', async () => {
    alerts.push(live('now'), scheduled('later'))

    const w = await render()

    expect(rows(w)).toHaveLength(1)
    expect(rows(w)[0].text()).toContain('Headline for now')
    expect(disclosure(w).text()).toContain('1 scheduled change')
  })

  it('counts one scheduled change in the singular', async () => {
    alerts.push(scheduled('only'))

    const w = await render()

    expect(disclosure(w).text()).toContain('1 scheduled change')
    expect(disclosure(w).text()).not.toContain('changes')
  })

  it('opens the scheduled chips on request, and folds them away again', async () => {
    alerts.push(scheduled('a'), scheduled('b'))

    const w = await render()
    await disclosure(w).trigger('click')
    expect(chips(w)).toHaveLength(2)

    await disclosure(w).trigger('click')
    expect(chips(w)).toHaveLength(0)
  })

  it('marks a live alert "Now" and a scheduled one with when it starts', async () => {
    alerts.push(live('a'), scheduled('b'))

    const w = await render()
    await disclosure(w).trigger('click')

    expect(rows(w)[0].text()).toContain('Now')
    expect(chips(w)[0].text()).not.toContain('Now')
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

    expect(rows(w)[0].text()).toContain('Until')
  })

  it('opens the detail directly under the row it belongs to', async () => {
    alerts.push(live('a'), live('b'))

    const w = await render()
    expect(w.find('article').exists()).toBe(false)

    await rows(w)[0].trigger('click')
    expect(w.find('article').text()).toContain('Headline for a')

    await rows(w)[0].trigger('click')
    expect(w.find('article').exists()).toBe(false)
  })

  it('swaps the open alert rather than stacking a second one', async () => {
    alerts.push(live('a'), live('b'))

    const w = await render()
    await rows(w)[0].trigger('click')
    await rows(w)[1].trigger('click')

    expect(w.findAll('article')).toHaveLength(1)
    expect(w.find('article').text()).toContain('Headline for b')
  })

  it('closes an open scheduled alert when its list is folded away', async () => {
    alerts.push(scheduled('a'))

    const w = await render()
    await disclosure(w).trigger('click')
    await chips(w)[0].trigger('click')
    expect(w.find('article').exists()).toBe(true)

    await disclosure(w).trigger('click')
    expect(w.find('article').exists()).toBe(false)
  })

  it('scrolls the scheduled chips horizontally rather than stacking them', async () => {
    alerts.push(scheduled('a'), scheduled('b'), scheduled('c'))

    const w = await render()
    await disclosure(w).trigger('click')
    const row = w.find('[data-testid="alert-row"]')

    expect(row.classes()).toContain('overflow-x-auto')
    // Runs to the panel edge rather than sitting inside its padding.
    expect(w.find('.edge-bleed').exists()).toBe(true)
    expect(chips(w)).toHaveLength(3)
  })
})
