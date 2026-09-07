import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import RouteDetailPage from './RouteDetailPage.vue'
import { useRouteDetailStore } from '@/stores/route-detail.store'

vi.mock('vue-i18n', async importOriginal => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}))

// The panel never talks to the network in these tests: the store is filled
// directly, which is also the only state the timeline geometry depends on.
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})) },
}))

vi.mock('@/services/layers/features/portolan/portolan-bullets', () => ({
  bulletFor: () => null,
  ensureBulletsAt: () => Promise.resolve(),
}))

function stop(i: number, withRoutes = false) {
  return {
    stopId: `s${i}`,
    stopName: `Stop ${i}`,
    lat: 40 + i * 0.01,
    lng: -73,
    distanceAlongRoute: i * 1000,
    ...(withRoutes
      ? { routes: [{ routeId: 'X', routeShortName: 'X', routeLongName: null, routeType: 1, routeColor: '00f', routeTextColor: 'fff', agencyName: null, via: 'station' as const }] }
      : {}),
  }
}

function px(style: string, prop: string): number {
  return parseFloat(new RegExp(`${prop}:\\s*([-\\d.]+)px`).exec(style)?.[1] ?? 'NaN')
}

async function mountWithStops(withRoutes: boolean) {
  setActivePinia(createPinia())
  const wrapper = mount(RouteDetailPage, {
    props: { feedId: 'f', routeId: 'F' },
    global: { stubs: { Select: true, SelectContent: true, SelectItem: true, SelectTrigger: true, SelectValue: true, ServiceAlerts: true, RouteBullet: true } },
  })
  const store = useRouteDetailStore()
  store.activeRoute = {
    feedId: 'f',
    routeId: 'F',
    routeShortName: 'F',
    routeLongName: 'Line F',
    routeColor: 'ff6319',
    routeTextColor: 'ffffff',
    routeType: 1,
    agencyName: null,
    stops: [0, 1, 2, 3].map(i => stop(i, withRoutes)),
    coordinates: null,
    relatedRouteIds: [],
  }
  store.isLoading = false
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('RouteDetailPage stop timeline', () => {
  beforeEach(() => setActivePinia(createPinia()))

  // The spine and the dots are placed by two independent bits of arithmetic;
  // when they disagree the line floats past the last stop and hangs off the
  // first, which is exactly the bug this pins.
  it.each([
    ['short rows', false],
    ['tall rows with transfer bullets', true],
  ])('threads the spine through every stop dot (%s)', async (_label, withRoutes) => {
    const wrapper = await mountWithStops(withRoutes)

    const spine = wrapper.find('.absolute.z-0')
    const dots = wrapper.findAll('.rounded-full.border-2')
    expect(dots.length).toBe(4)

    const spineStyle = spine.attributes('style') ?? ''
    const spineTop = px(spineStyle, 'top')
    const spineBottom = spineTop + px(spineStyle, 'height')

    const centerOf = (i: number) => {
      const style = dots[i].attributes('style') ?? ''
      return px(style, 'top') + px(style, 'height') / 2
    }

    expect(centerOf(0)).toBeCloseTo(spineTop, 5)
    expect(centerOf(3)).toBeCloseTo(spineBottom, 5)
    // and the intermediate dots sit at even intervals along it
    expect(centerOf(1) - centerOf(0)).toBeCloseTo(centerOf(2) - centerOf(1), 5)
  })
})
