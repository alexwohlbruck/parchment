import { beforeEach, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import LayerGroupItem from './LayerGroupItem.vue'
import en from '@/lib/i18n/en-US.json'

const updateLayerGroup = vi.hoisted(() => vi.fn())
vi.mock('@/stores/layers.store', () => ({
  useLayersStore: () => ({
    getGroupTotalLayerCount: () => 2,
    updateLayerGroup,
  }),
}))
vi.mock('@/services/layers/layers.service', () => ({
  useLayersService: () => ({ setGroupShownInSelector: vi.fn() }),
}))
vi.mock('@/services/app.service', () => ({
  useAppService: () => ({ componentDialog: vi.fn() }),
}))
vi.mock('@/composables/map/useDragAndDrop', () => ({
  useDragAndDrop: () => ({
    groupDragOptions: {},
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onDragMove: vi.fn(),
    getLayerKey: (layer: any) => layer.id,
  }),
}))
vi.mock('./LayerGroupConfiguration.vue', () => ({
  default: { template: '<div />' },
}))
vi.mock('./LayerItem.vue', () => ({
  default: { template: '<div>Layer</div>' },
}))
const global = {
  plugins: [
    createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': en } }),
  ],
  stubs: {
    Tooltip: { template: '<span><slot /></span>' },
    TooltipTrigger: { template: '<span><slot /></span>' },
    TooltipContent: true,
    draggable: {
      props: ['modelValue'],
      template:
        '<div><template v-for="element in modelValue"><slot name="item" :element="element" /></template></div>',
    },
  },
}
const child = {
  id: 'rail',
  name: 'Rail',
  order: 0,
  origin: 'custom',
  layers: [],
  children: [],
  showInLayerSelector: true,
}
const group = {
  id: 'transit',
  name: 'Transit',
  order: 0,
  origin: 'custom',
  layers: [],
  children: [child],
  showInLayerSelector: true,
}

beforeEach(() => vi.clearAllMocks())

it('uses the common disclosure and preserves the layer expansion event', async () => {
  const wrapper = mount(LayerGroupItem, {
    props: { group: group as any, expandedGroups: new Set(['transit']) },
    global,
  })
  expect(wrapper.find('[role="group"][aria-label="Rail"]').exists()).toBe(true)
  await wrapper.find('button[aria-expanded]').trigger('click')
  expect(wrapper.emitted('toggleExpanded')).toEqual([['transit']])
  expect(updateLayerGroup).not.toHaveBeenCalled()
})

it('expands nested groups while filtering and lets custom groups rename inline', async () => {
  const wrapper = mount(LayerGroupItem, {
    props: {
      group: group as any,
      expandedGroups: new Set<string>(),
      filter: 'Rail',
    },
    global,
  })
  expect(wrapper.find('[role="group"][aria-label="Rail"]').exists()).toBe(true)
  expect(
    wrapper
      .find('[aria-label="Rail"] button[aria-expanded]')
      .attributes('aria-expanded'),
  ).toBe('true')
  await wrapper
    .find('[aria-label="Transit"] span[title="Rename"]')
    .trigger('click')
  await wrapper.find('input').setValue('  Public transport  ')
  await wrapper.find('input').trigger('keydown.enter')
  expect(updateLayerGroup).toHaveBeenCalledWith('transit', {
    name: 'Public transport',
  })
})

it('keeps default layer-group names read-only', () => {
  const wrapper = mount(LayerGroupItem, {
    props: {
      group: { ...group, origin: 'default', children: [] } as any,
      expandedGroups: new Set<string>(),
    },
    global,
  })
  expect(wrapper.find('span[title="Rename"]').exists()).toBe(false)
})
