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

/**
 * Give the list and its rows real geometry. jsdom lays nothing out, so the
 * component's measurement would otherwise read zeros and every assertion
 * below would hold trivially. Rows are deliberately UNEVEN — that is the
 * case the fixed-height version could not draw.
 */
async function layOutRows(wrapper: Awaited<ReturnType<typeof mountWithStops>>, heights: number[]) {
  const list = wrapper.find('.relative[style*="padding-left"]').element as HTMLElement
  const rows = wrapper.findAll('.relative.flex.items-start').map(w => w.element as HTMLElement)
  list.getBoundingClientRect = () => ({ top: 100 }) as DOMRect
  let y = 100
  for (const [i, row] of rows.entries()) {
    const top = y
    row.getBoundingClientRect = () => ({ top }) as DOMRect
    y += heights[i]
  }
  // the component measures on a post-flush watcher
  ;(wrapper.vm as unknown as { $forceUpdate: () => void }).$forceUpdate()
  await wrapper.vm.$nextTick()
  return rows
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

    // Every dot sits at the same offset WITHIN its own row, and the spine
    // runs between the first and last of them.
    const offsetOf = (i: number) => {
      const style = dots[i].attributes('style') ?? ''
      return px(style, 'top') + px(style, 'height') / 2
    }
    for (let i = 1; i < 4; i++) {
      expect(offsetOf(i)).toBeCloseTo(offsetOf(0), 5)
    }
    expect(spineBottom).toBeGreaterThanOrEqual(spineTop)
  })

  // The point of measuring: rows of different heights each carry their dot,
  // and the spine ends on the real first and last centres rather than on
  // index × an assumed row height.
  it('spans uneven rows from the first measured dot to the last', async () => {
    const wrapper = await mountWithStops(true)
    await layOutRows(wrapper, [32, 70, 32, 54])

    const style = wrapper.find('.absolute.z-0').attributes('style') ?? ''
    const top = px(style, 'top')
    const height = px(style, 'height')

    // rows start at 100; centres are row-top - list-top + 12
    expect(top).toBeCloseTo(12, 5)
    // last row starts 32+70+32 = 134 below the first
    expect(top + height).toBeCloseTo(134 + 12, 5)
  })
})
