import { describe, it, expect, vi } from 'vitest'
import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import CollectionGroupList from './CollectionGroupList.vue'
import CollectionGroupForm from './CollectionGroupForm.vue'
import type { Collection } from '@/types/library.types'
import en from '@/lib/i18n/en-US.json'

const store = reactive({
  ready: true,
  editable: true,
  saving: false,
  collectionGroupIds: new Map([['cafes', 'coffee']]),
  organization: {
    revision: 0,
    groups: [
      { id: 'city', name: 'New York', parentId: null },
      { id: 'food', name: 'Food', parentId: 'city' },
      { id: 'coffee', name: 'Coffee', parentId: 'food' },
      { id: 'other', name: 'Boston', parentId: null },
    ],
    placements: [{ collectionId: 'cafes', groupId: 'coffee' }],
  },
})
vi.mock('@/stores/library/collection-groups.store', () => ({
  useCollectionGroupsStore: () => store,
}))
vi.mock('./collection-group-dialog', () => ({
  createCollectionGroup: vi.fn(),
  moveCollectionGroup: vi.fn(),
  deleteCollectionGroup: vi.fn(),
  createCollectionInGroup: vi.fn(),
}))
vi.mock('@/services/library/collection-groups.service', () => ({
  useCollectionGroupsService: () => ({ updateGroup: vi.fn() }),
}))

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': en },
})
const collections = [
  { id: 'cafes', name: 'Cafes' },
  { id: 'parks', name: 'Parks' },
] as Collection[]
const global = {
  plugins: [i18n],
  stubs: {
    CollectionCard: {
      props: ['collection'],
      template: '<div class="collection-card">{{ collection.name }}</div>',
    },
    ResponsiveDropdown: { template: '<div />' },
  },
}

describe('collection group tree', () => {
  it('renders deeply nested collections once and keeps ungrouped collections at the root', () => {
    const wrapper = mount(CollectionGroupList, {
      props: { collections, groups: store.organization.groups },
      global,
    })
    expect(wrapper.findAll('.collection-card')).toHaveLength(2)
    expect(wrapper.find('[aria-label="Coffee"]').text()).toContain('Cafes')
    expect(wrapper.find('[aria-label="New York"]').text()).not.toContain(
      'Parks',
    )
  })

  it('collapses a group and expands it when searching', async () => {
    const wrapper = mount(CollectionGroupList, {
      props: { collections, groups: store.organization.groups },
      global,
    })
    await wrapper.find('[aria-label="New York"] button').trigger('click')
    expect(wrapper.find('[aria-label="Coffee"]').exists()).toBe(false)
    expect(wrapper.findAll('.collection-card')).toHaveLength(1)
    await wrapper.setProps({ searching: true })
    expect(wrapper.find('[aria-label="Coffee"]').text()).toContain('Cafes')
  })

  it('keeps a nested group collapsed when its parent is reopened', async () => {
    const wrapper = mount(CollectionGroupList, {
      props: { collections, groups: store.organization.groups },
      global,
    })
    await wrapper
      .find('[aria-label="Food"] button[aria-expanded]')
      .trigger('click')
    expect(wrapper.find('[aria-label="Coffee"]').exists()).toBe(false)
    await wrapper
      .find('[aria-label="New York"] button[aria-expanded]')
      .trigger('click')
    await wrapper
      .find('[aria-label="New York"] button[aria-expanded]')
      .trigger('click')
    expect(
      wrapper
        .find('[aria-label="Food"] button[aria-expanded]')
        .attributes('aria-expanded'),
    ).toBe('false')
    expect(wrapper.find('[aria-label="Coffee"]').exists()).toBe(false)
  })

  it('shows an empty group and treats missing placements as ungrouped', () => {
    const wrapper = mount(CollectionGroupList, {
      props: {
        collections: [
          ...collections,
          { id: 'unknown', name: 'Unknown' } as Collection,
        ],
        groups: store.organization.groups,
      },
      global,
    })
    expect(wrapper.find('[aria-label="Boston"]').text()).toContain(
      'No collections',
    )
    expect(wrapper.findAll('.collection-card')).toHaveLength(3)
  })
})

describe('group form', () => {
  it('excludes the group and all descendants from parent choices', () => {
    const wrapper = mount(CollectionGroupForm, {
      props: { groupId: 'food', name: 'Food', parentId: 'city' },
      global,
    })
    expect(
      wrapper.findAll('option').map(option => option.attributes('value')),
    ).toEqual(['', 'other', 'city'])
    expect(wrapper.text()).toContain('All collections')
  })

  it('requires a nonblank name and submits a trimmed name and destination', async () => {
    const wrapper = mount(CollectionGroupForm, { global })
    const input = wrapper.find('input')
    await input.setValue('   ')
    expect(wrapper.emitted('update:valid')?.at(-1)).toEqual([false])
    await input.setValue('  Chicago  ')
    await wrapper.find('select').setValue('city')
    expect(wrapper.emitted('update:valid')?.at(-1)).toEqual([true])
    expect(
      (wrapper.vm as unknown as { submit: () => unknown }).submit(),
    ).toEqual({ name: 'Chicago', parentId: 'city' })
  })
})
