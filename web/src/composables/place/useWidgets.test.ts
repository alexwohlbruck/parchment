import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import type { Place, WidgetDescriptor } from '@/types/place.types'
import { WidgetDataType, WidgetType } from '@/types/place.types'
import { useWidgets } from './useWidgets'

const get = vi.fn(async () => ({ data: { data: { value: {} } } }))
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => get(...args) } }))

const descriptor = {
  type: WidgetType.RELATED_PLACES,
  dataType: WidgetDataType.ASYNC,
  params: { strategy: 'parent' },
} as unknown as WidgetDescriptor

async function mountWidgets() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/place/:id', component: { render: () => null } }],
  })
  await router.push('/place/1')
  const place = ref<Partial<Place>>({ widgets: [descriptor] })
  const Host = defineComponent({
    setup() {
      useWidgets(place)
      return () => h('div')
    },
  })
  mount(Host, { global: { plugins: [router] } })
  await flushPromises()
  return { router }
}

describe('useWidgets', () => {
  it('keeps widget data when only the tab changes', async () => {
    get.mockClear()
    const { router } = await mountWidgets()
    expect(get).toHaveBeenCalledTimes(1)

    await router.replace({ query: { tab: 'related:parent' } })
    await router.replace({ query: {} })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('refetches when the URL asks for the whole station complex', async () => {
    get.mockClear()
    const { router } = await mountWidgets()

    await router.replace({ query: { complex: '1' } })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
  })
})
