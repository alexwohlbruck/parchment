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

  it('splits a transfer walk into a walking span and a trailing wait span', () => {
    // 420s transfer segment = 255s walking + 165s waiting (server-computed).
    const wrapper = mountTrip([
      seg({ mode: 'transit', lineName: '2', routeType: 'subway', endTime: new Date('2026-06-12T14:00:00Z') }),
      seg({
        mode: 'walking',
        startTime: new Date('2026-06-12T14:00:00Z'),
        endTime: new Date('2026-06-12T14:07:00Z'),
        duration: 420,
        distance: 345,
        waitSeconds: 165,
      }),
      seg({ mode: 'transit', lineName: 'F', routeType: 'subway', startTime: new Date('2026-06-12T14:07:00Z') }),
    ])
    const spans = (wrapper.vm as unknown as {
      trackSpans: { type: string; width: number }[]
    }).trackSpans
    const walk = spans.find((s) => s.type === 'walk')
    const wait = spans.find((s) => s.type === 'wait')
    expect(walk).toBeDefined()
    expect(wait).toBeDefined()
    // walking comes before waiting on the track
    expect(walk!.width).toBeGreaterThan(0)
    expect(wait!.width).toBeGreaterThan(0)
  })

  it('does not add a wait span to an access walk with no absorbed wait', () => {
    // A walk inside a multimodal trip still uses the dotted track.
    const wrapper = mountTrip([
      seg({ mode: 'walking', duration: 600, distance: 800 }),
      seg({ mode: 'transit', lineName: 'Q', routeType: 'subway', duration: 600 }),
    ])
    const spans = (wrapper.vm as unknown as {
      trackSpans: { type: string }[]
    }).trackSpans
    expect(spans.some((s) => s.type === 'wait')).toBe(false)
    expect(spans.some((s) => s.type === 'walk')).toBe(true)
  })

  it('renders a walking-only trip as a single pill, not the dotted track', () => {
    const wrapper = mountTrip([
      seg({ mode: 'walking', duration: 600, distance: 800 }),
    ])
    const vm = wrapper.vm as unknown as {
      trackSpans: unknown[]
      isWalkingOnly: boolean
    }
    // No dotted ticks — the walk is a solid pill instead.
    expect(vm.isWalkingOnly).toBe(true)
    expect(vm.trackSpans.length).toBe(0)
    const pills = wrapper.findAll('[title]').filter((n) => n.attributes('title')?.length)
    expect(pills.length).toBe(1)
    // Walking-mode pill (mocked getTravelModeCssClass → "mode-walking";
    // real class is bg-cobalt-400 — the blue pill)
    expect(pills[0].classes()).toContain('mode-walking')
  })

  it('labels trips by combination type, not longest mode', () => {
    // Long walks + subway: walking dominates by duration, but the trip is
    // transit — labelled "Transit & Walking" (mocked t echoes the key).
    const longWalks = mountTrip([
      seg({ mode: 'walking', duration: 600 }),
      seg({ mode: 'transit', lineName: 'Q', routeType: 'subway', duration: 400 }),
      seg({ mode: 'walking', duration: 500 }),
    ])
    expect(longWalks.text()).toContain('directions.tripTypes.transitWalking')

    // Short access walks: plain "Transit"
    const shortWalks = mountTrip([
      seg({ mode: 'walking', duration: 120 }),
      seg({ mode: 'transit', lineName: 'Q', routeType: 'subway', duration: 1500 }),
      seg({ mode: 'walking', duration: 100 }),
    ])
    expect(shortWalks.text()).toContain('directions.tripTypes.transit')
    expect(shortWalks.text()).not.toContain('transitWalking')

    // Drive + transit: Park & Ride
    const pnr = mountTrip([
      seg({ mode: 'driving', duration: 600 }),
      seg({ mode: 'walking', duration: 100 }),
      seg({ mode: 'transit', lineName: '4', routeType: 'subway', duration: 900 }),
    ])
    expect(pnr.text()).toContain('directions.tripTypes.parkAndRide')

    // Shared bike egress: Transit & Bike Share
    const share = mountTrip([
      seg({ mode: 'transit', lineName: 'A', routeType: 'subway', duration: 900 }),
      seg({ mode: 'cycling', duration: 300, sharedMobilityDetails: { vehicleType: 'bike', provider: 'Citi Bike' } }),
    ])
    expect(share.text()).toContain('directions.tripTypes.transitBikeShare')

    // Direct shared bike (no transit): Bike Share, not Cycling or Scootershare
    const directShare = mountTrip([
      seg({ mode: 'walking', duration: 120 }),
      seg({ mode: 'cycling', duration: 900, ownership: 'shared', sharedMobilityDetails: { vehicleType: 'bike', provider: 'Citi Bike' } }),
      seg({ mode: 'walking', duration: 100 }),
    ])
    expect(directShare.text()).toContain('directions.tripTypes.bikeshare')
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
