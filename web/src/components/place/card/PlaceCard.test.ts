import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import PlaceCard from './PlaceCard.vue'
import { AppRoute } from '@/router'
import type { Place } from '@/types/place.types'

// Only `useI18n` is stubbed — the real module is still loaded, since the app's
// i18n singleton is constructed at import time by other modules in the graph.
vi.mock('vue-i18n', async importOriginal => ({
  ...(await importOriginal<typeof import('vue-i18n')>()),
  useI18n: () => ({ t: (key: string) => key }),
}))

const setPartialPlace = vi.fn()
vi.mock('@/services/place.service', () => ({
  usePlaceService: () => ({ setPartialPlace }),
}))

let router: Router

beforeEach(async () => {
  setActivePinia(createPinia())
  setPartialPlace.mockClear()
  const stub = { template: '<div />' }
  router = createRouter({
    history: createMemoryHistory(),
    // Place routes are resolved by name, so the names have to be registered.
    routes: [
      { path: '/', component: stub },
      { path: '/place/:type/:id', name: AppRoute.PLACE, component: stub },
      {
        path: '/place/provider/:provider/:placeId',
        name: AppRoute.PLACE_PROVIDER,
        component: stub,
      },
      { path: '/place/coords/:lat/:lng', name: AppRoute.PLACE_COORDS, component: stub },
    ],
  })
  router.push('/')
  await router.isReady()
})

function place(partial: Record<string, unknown> = {}): Place {
  return {
    id: 'p1',
    name: { value: 'Blue Bottle Coffee' },
    placeType: { value: 'cafe' },
    address: { value: { street1: '300 Webster St', locality: 'Oakland' } },
    externalIds: {},
    contactInfo: { phone: { value: '+1 510 555 0100' }, email: null, website: null, socials: {} },
    ratings: { rating: { value: 0.9 }, reviewCount: { value: 1240 } },
    summary: 'Outdoor seating · Wi-Fi',
    ...partial,
  } as unknown as Place
}

function mountCard(props: Record<string, unknown>) {
  return mount(PlaceCard, {
    props: { place: place(), ...props },
    global: { plugins: [router] },
  })
}

describe('PlaceCard density', () => {
  it('compact shows one detail line and no rating', () => {
    const w = mountCard({ density: 'compact' })
    expect(w.text()).toContain('Blue Bottle Coffee')
    expect(w.text()).toContain('Cafe')
    expect(w.text()).not.toContain('300 Webster St')
    expect(w.text()).not.toContain('4.5')
  })

  it('default adds the address but withholds rating, summary and phone', () => {
    const w = mountCard({ density: 'default' })
    expect(w.text()).toContain('300 Webster St, Oakland')
    expect(w.text()).not.toContain('4.5')
    expect(w.text()).not.toContain('Outdoor seating')
    expect(w.text()).not.toContain('555 0100')
  })

  it('rich shows everything the record carries', () => {
    const w = mountCard({ density: 'rich' })
    const text = w.text()
    expect(text).toContain('Cafe')
    expect(text).toContain('4.5')
    expect(text).toContain('1,240')
    expect(text).toContain('Outdoor seating · Wi-Fi')
    expect(text).toContain('300 Webster St, Oakland')
    expect(text).toContain('+1 510 555 0100')
  })
})

describe('PlaceCard overrides', () => {
  it('an explicit title replaces the derived one', () => {
    expect(mountCard({ title: 'Parking' }).text()).toContain('Parking')
  })

  it('an explicit subtitle replaces every derived detail line', () => {
    const w = mountCard({ density: 'rich', subtitle: 'just this' })
    expect(w.text()).toContain('just this')
    expect(w.text()).not.toContain('300 Webster St')
    expect(w.text()).not.toContain('Outdoor seating')
  })

  it('an empty subtitle claims the detail area and leaves it blank', () => {
    // Distinct from omitting it: the caller wants no detail line at all, not a
    // fallback to the derived ones.
    const w = mountCard({ density: 'rich', subtitle: '' })
    expect(w.text()).toContain('Blue Bottle Coffee')
    expect(w.text()).not.toContain('300 Webster St')
    expect(w.text()).not.toContain('Cafe')
  })
})

describe('PlaceCard variants', () => {
  it('renders a link that navigates, seeding the detail view first', async () => {
    const w = mountCard({})
    expect(w.element.tagName).toBe('A')
    await w.trigger('click')
    expect(setPartialPlace).toHaveBeenCalledOnce()
  })

  it('renders a plain element when navigation is off', () => {
    const w = mountCard({ navigate: false })
    expect(w.element.tagName).toBe('DIV')
  })

  it('chip collapses to icon and title only', () => {
    const w = mountCard({ variant: 'chip', density: 'rich' })
    expect(w.text()).toContain('Blue Bottle Coffee')
    expect(w.text()).not.toContain('300 Webster St')
    expect(w.attributes('class')).toContain('rounded-full')
  })

  it('hides the icon on request', () => {
    expect(mountCard({ showIcon: false }).find('.size-8').exists()).toBe(false)
  })
})

describe('PlaceCard icon sizing', () => {
  // The icon tracks the height of the text beside it. Sizing it off `size`
  // alone left one-line rows tall and empty, with the icon towering over a
  // single line of text.
  it('steps up when detail lines are present', () => {
    const bare = mountCard({ size: 'xs', subtitle: '' })
    const detailed = mountCard({ size: 'xs', subtitle: '35 E Broadway' })
    expect(bare.find('.size-5').exists()).toBe(true) // 20px
    expect(detailed.find('.size-8').exists()).toBe(true) // 32px
  })

  it('derives title-only from the rendered lines, not just the override', () => {
    // No address, no summary, no phone → nothing to render under the title.
    const sparse = mountCard({
      size: 'md',
      density: 'default',
      place: place({ address: null, summary: null, placeType: { value: 'place' } }),
    })
    expect(sparse.find('.size-8').exists()).toBe(true)

    const rich = mountCard({ size: 'md', density: 'default' })
    expect(rich.text()).toContain('300 Webster St')
  })

  it('never lets the md icon overhang its text block', () => {
    // Both md cases anchor on 32px; 40px would be taller than the ~38px text.
    expect(mountCard({ size: 'md', subtitle: '' }).find('.size-10').exists()).toBe(false)
    expect(mountCard({ size: 'md', density: 'rich' }).find('.size-10').exists()).toBe(false)
  })

  it('drops the address pin below rich density', () => {
    const dense = mountCard({ density: 'default' })
    const rich = mountCard({ density: 'rich' })
    expect(dense.findAll('svg.size-3').length).toBeLessThan(
      rich.findAll('svg.size-3').length,
    )
  })
})

describe('PlaceCard slots', () => {
  it('renders trailing content alongside the text block', () => {
    const w = mount(PlaceCard, {
      props: { place: place() },
      slots: { trailing: '<button class="menu">menu</button>' },
      global: { plugins: [router] },
    })
    expect(w.find('button.menu').exists()).toBe(true)
  })
})
