import { describe, it, expect } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Sidebar from './Sidebar.vue'
import SidebarMenu from './SidebarMenu.vue'
import SidebarMenuItem from './SidebarMenuItem.vue'

const Blank = defineComponent({ render: () => h('div') })

/** The chip is measured after mount, so it lands a couple of ticks later. */
const flush = async () => {
  await nextTick()
  await nextTick()
  await nextTick()
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Blank },
      { path: '/library', component: Blank },
      { path: '/library/collections', component: Blank },
      { path: '/timeline', component: Blank },
    ],
  })
}

/**
 * Rows carry the active state the travelling chip is positioned from, so the
 * cheap-looking `data-active` attribute is load-bearing.
 */
function mountMenu(
  items: { label: string; to?: string; active?: boolean }[],
  router: ReturnType<typeof makeRouter>,
  collapsed = false,
) {
  const Harness = defineComponent({
    render: () =>
      h(Sidebar, { collapsed }, () => [
        h(SidebarMenu, null, () =>
          items.map(item => h(SidebarMenuItem, { key: item.label, ...item })),
        ),
      ]),
  })
  return mount(Harness, { global: { plugins: [router] } })
}

describe('SidebarMenuItem', () => {
  it('marks the row whose route prefix the current path matches', async () => {
    const router = makeRouter()
    await router.push('/library/collections')
    await router.isReady()

    const w = mountMenu(
      [
        { label: 'Library', to: '/library' },
        { label: 'Timeline', to: '/timeline' },
      ],
      router,
    )
    await nextTick()

    const rows = w.findAll('li[data-active]')
    expect(rows.map(r => r.attributes('data-active'))).toEqual(['true', 'false'])
    expect(w.get('a[aria-current="page"]').text()).toBe('Library')
  })

  it('follows navigation, so the chip can travel', async () => {
    const router = makeRouter()
    await router.push('/library')
    await router.isReady()

    const w = mountMenu(
      [
        { label: 'Library', to: '/library' },
        { label: 'Timeline', to: '/timeline' },
      ],
      router,
    )
    await nextTick()
    expect(w.findAll('li[data-active]').map(r => r.attributes('data-active')))
      .toEqual(['true', 'false'])

    await router.push('/timeline')
    await nextTick()
    expect(w.findAll('li[data-active]').map(r => r.attributes('data-active')))
      .toEqual(['false', 'true'])
  })

  it('falls back to the route when no active prop is passed', async () => {
    // Vue casts an absent boolean prop to `false`; if that value reached the
    // active check it would silently beat the route and nothing would ever
    // look selected.
    const router = makeRouter()
    await router.push('/timeline')
    await router.isReady()

    const w = mountMenu([{ label: 'Timeline', to: '/timeline' }], router)
    await nextTick()

    expect(w.get('li[data-active]').attributes('data-active')).toBe('true')
  })

  it('lets an explicit active prop win over the route', async () => {
    const router = makeRouter()
    await router.push('/timeline')
    await router.isReady()

    const w = mountMenu(
      [
        { label: 'Timeline', to: '/timeline', active: false },
        { label: 'Library', to: '/library', active: true },
      ],
      router,
    )
    await nextTick()

    expect(w.findAll('li[data-active]').map(r => r.attributes('data-active')))
      .toEqual(['false', 'true'])
  })

  it('renders an action row as a button and emits its click', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const w = mountMenu([{ label: 'Search' }], router)
    await nextTick()

    const button = w.get('li button')
    expect(button.attributes('type')).toBe('button')
    expect(w.find('li a').exists()).toBe(false)

    await button.trigger('click')
    expect(
      w.findComponent(SidebarMenuItem).emitted('click'),
    ).toHaveLength(1)
  })
})

describe('SidebarMenu', () => {
  it('only draws the chip when something is active', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const inactive = mountMenu([{ label: 'Timeline', to: '/timeline' }], router)
    await flush()
    expect(inactive.find('li[aria-hidden="true"]').exists()).toBe(false)

    await router.push('/timeline')
    const active = mountMenu([{ label: 'Timeline', to: '/timeline' }], router)
    await flush()
    expect(active.find('li[aria-hidden="true"]').exists()).toBe(true)
  })
})
