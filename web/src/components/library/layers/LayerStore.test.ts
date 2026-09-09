import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import LayerStoreCard from './LayerStoreCard.vue'
import LayerStoreDetail from './LayerStoreDetail.vue'
import en from '@/lib/i18n/en-US.json'
import type { LayerStoreItem } from '@/lib/layer-templates'

/**
 * The store's two presentational pieces.
 *
 * A card has to read the same whether the bundle is on offer or already in the
 * library — the add action is the only thing that differs — and a bundle's page
 * has to spell out what it will actually put in the library, under the same
 * subgroups it will land in.
 */

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': en },
})

const mountOpts = { global: { plugins: [i18n] } }

// ItemIcon reads the theme store, so every mount needs an active Pinia.
beforeEach(() => setActivePinia(createPinia()))

function item(overrides: Partial<LayerStoreItem> = {}): LayerStoreItem {
  return {
    templateId: 'default:group:terrain',
    type: 'group',
    name: 'Terrain',
    description: 'Hillshading and elevation contours over the basemap.',
    icon: 'MountainSnowIcon',
    layers: [
      { templateId: 'default:hillshade', name: 'Hillshade' },
      { templateId: 'default:contours', name: 'Contours' },
    ],
    added: false,
    ...overrides,
  }
}

describe('LayerStoreCard', () => {
  it('shows the bundle, its blurb and how many layers it brings', () => {
    const w = mount(LayerStoreCard, { props: { item: item() }, ...mountOpts })

    expect(w.text()).toContain('Terrain')
    expect(w.text()).toContain('Hillshading and elevation contours')
    expect(w.text()).toContain('2 layers')
  })

  it('offers Add for a bundle that is not in the library', async () => {
    const w = mount(LayerStoreCard, { props: { item: item() }, ...mountOpts })

    await w.find('button').trigger('click')

    expect(w.emitted('add')).toHaveLength(1)
  })

  it('adding does not also open the bundle page', async () => {
    const w = mount(LayerStoreCard, { props: { item: item() }, ...mountOpts })

    await w.find('button').trigger('click')

    expect(w.emitted('open')).toBeUndefined()
  })

  it('opens the bundle page when the card body is clicked', async () => {
    const w = mount(LayerStoreCard, { props: { item: item() }, ...mountOpts })

    await w.trigger('click')

    expect(w.emitted('open')).toHaveLength(1)
  })

  it('drops the add action once the bundle is in the library', () => {
    const w = mount(LayerStoreCard, {
      props: { item: item({ added: true }) },
      ...mountOpts,
    })

    expect(w.find('button').exists()).toBe(false)
    expect(w.text()).toContain('Added')
  })

  it('will not fire a second add while one is in flight', () => {
    const w = mount(LayerStoreCard, {
      props: { item: item(), adding: true },
      ...mountOpts,
    })

    expect(w.find('button').attributes('disabled')).toBeDefined()
  })
})

describe('LayerStoreDetail', () => {
  it('lists every layer the bundle will add', () => {
    const w = mount(LayerStoreDetail, { props: { item: item() }, ...mountOpts })

    expect(w.text()).toContain('Includes 2 layers')
    expect(w.findAll('li').map(li => li.text())).toEqual([
      'Hillshade',
      'Contours',
    ])
  })

  it('groups layers under their subgroup, keeping template order', () => {
    const w = mount(LayerStoreDetail, {
      props: {
        item: item({
          layers: [
            { templateId: 'a', name: 'Bike lanes', groupName: 'Cycleways' },
            { templateId: 'b', name: 'Overview' },
            { templateId: 'c', name: 'Cycle tracks', groupName: 'Cycleways' },
          ],
        }),
      },
      ...mountOpts,
    })

    const lists = w.findAll('ul')
    expect(lists).toHaveLength(2)
    expect(lists[0].findAll('li').map(li => li.text())).toEqual([
      'Bike lanes',
      'Cycle tracks',
    ])
    expect(lists[1].findAll('li').map(li => li.text())).toEqual(['Overview'])
    expect(w.text()).toContain('Cycleways')
  })

  it('adds the bundle from its own page', async () => {
    const w = mount(LayerStoreDetail, { props: { item: item() }, ...mountOpts })

    await w.find('button').trigger('click')

    expect(w.emitted('add')).toHaveLength(1)
  })

  it('shows no add action for a bundle already in the library', () => {
    const w = mount(LayerStoreDetail, {
      props: { item: item({ added: true }) },
      ...mountOpts,
    })

    expect(w.find('button').exists()).toBe(false)
    expect(w.text()).toContain('Added')
  })
})
