import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TripItem from './TripItem.vue'

// ── Stub the heavy, environment-coupled dependencies ─────────────────────────
vi.mock('@/services/map.service', () => ({
  useMapService: () => ({ showTripOnHover: vi.fn() }),
}))
vi.mock('@/composables/useUnits', () => ({
  useUnits: () => ({ formatDistance: (m: number) => `${(m / 1609).toFixed(1)} mi` }),
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, args?: Record<string, unknown>) =>
      args ? `${key} ${JSON.stringify(args)}` : key,
  }),
}))
// Icons → trivial stub components so getSegmentIcon/getModeIcon resolve
vi.mock('@/lib/travel-mode-icons', () => ({
  getSegmentIcon: () => ({ template: '<i class="seg-icon" />' }),
  getModeIcon: () => ({ template: '<i class="mode-icon" />' }),
}))
vi.mock('@/lib/travel-mode-colors', () => ({
  getTravelModeCssClass: (m: string) => `mode-${m}`,
  getTravelModeColor: () => '#888',
}))

function seg(partial: Record<string, unknown>) {
  return {
    id: Math.random().toString(36).slice(2),
    startTime: new Date('2026-06-12T14:00:00Z'),
    endTime: new Date('2026-06-12T14:05:00Z'),
    duration: 300,
    distance: 400,
    legIndex: 0,
    ...partial,
  }
}

function mountTrip(segments: Record<string, unknown>[]) {
  return mount(TripItem, {
    props: {
      trip: {
        id: 't1',
        mode: 'transit',
        summary: { totalDuration: 1800, totalDistance: 9000 },
        segments,
      } as never,
      tripRequest: {} as never,
      timelineStart: new Date('2026-06-12T13:55:00Z'),
      pxPerMinute: 8,
      sidebarWidth: 80,
    },
  })
}

describe('TripItem timeline rendering', () => {
  it('renders transit legs as pills and walking as the dotted track (no pill)', () => {
    const wrapper = mountTrip([
      seg({ mode: 'walking' }),
      seg({ mode: 'transit', lineName: 'Q', lineColor: 'FCCC0A', lineTextColor: '000000', routeType: 'subway', headsign: 'Coney Island' }),
      seg({ mode: 'walking' }),
    ])
    // Two walk segments + one transit ⇒ exactly one pill rendered
    const pills = wrapper.findAll('[title]').filter(n => n.attributes('title')?.length)
    expect(pills.length).toBe(1)
    // The single pill shows the line name
    expect(wrapper.text()).toContain('Q')
    // Walking is not labelled as a pill anywhere
    const walkLabels = wrapper.findAll('.mode-walking')
    expect(walkLabels.length).toBe(0)
  })

  it('shows a single quiet headsign line, not a card row', () => {
    const wrapper = mountTrip([
      seg({ mode: 'walking' }),
      seg({ mode: 'transit', lineName: 'A', headsign: 'Inwood-207 St', routeType: 'subway' }),
      seg({ mode: 'walking' }),
    ])
    // toward key is rendered (i18n stub echoes key+args)
    expect(wrapper.text()).toContain('directions.toward')
    expect(wrapper.text()).toContain('Inwood-207 St')
  })

  it('renders a pill per vehicle leg for multi-transfer trips', () => {
    const wrapper = mountTrip([
      seg({ mode: 'walking' }),
      seg({ mode: 'transit', lineName: 'B49', routeType: 'bus' }),
      seg({ mode: 'walking' }),
      seg({ mode: 'transit', lineName: 'A', routeType: 'subway' }),
      seg({ mode: 'walking' }),
    ])
    const pills = wrapper.findAll('[title]').filter(n => n.attributes('title')?.length)
    expect(pills.length).toBe(2)
    expect(wrapper.text()).toContain('B49')
    expect(wrapper.text()).toContain('A')
  })
})
