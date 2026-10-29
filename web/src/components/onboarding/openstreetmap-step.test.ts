import { beforeEach, expect, test, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import OpenStreetMapStep from './OpenStreetMapStep.vue'

const mocks = vi.hoisted(() => ({ connect: vi.fn(), fetch: vi.fn() }))
const profile = reactive<{ osmProfile: null | { osmDisplayName: string } }>({ osmProfile: null })
vi.mock('@/stores/integrations.store', () => ({ useIntegrationsStore: () => profile }))
vi.mock('@/services/integration.service', () => ({ useIntegrationService: () => ({ fetchConfiguredIntegrations: mocks.fetch }) }))
vi.mock('@/composables/integrations/useOsmConnection', () => ({ useOsmConnection: () => ({ connect: mocks.connect, connecting: ref(false) }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

beforeEach(() => {
  vi.clearAllMocks()
  profile.osmProfile = null
  mocks.fetch.mockResolvedValue([])
})

test('checks the account before offering the shared connection flow', async () => {
  const wrapper = mount(OpenStreetMapStep)
  expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  await flushPromises()
  expect(mocks.fetch).toHaveBeenCalledOnce()
  await wrapper.get('button').trigger('click')
  expect(mocks.connect).toHaveBeenCalledOnce()
  wrapper.unmount()
})

test('advances once when the account becomes connected', async () => {
  const wrapper = mount(OpenStreetMapStep)
  await flushPromises()
  profile.osmProfile = { osmDisplayName: 'Local Mapper' }
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toContain('Local Mapper')
  expect(wrapper.find('button').exists()).toBe(false)
  expect(wrapper.emitted('complete')).toHaveLength(1)
  profile.osmProfile = { osmDisplayName: 'Updated Mapper' }
  await flushPromises()
  expect(wrapper.emitted('complete')).toHaveLength(1)
  wrapper.unmount()
})

test('keeps an already connected account visible when navigating back', async () => {
  profile.osmProfile = { osmDisplayName: 'Local Mapper' }
  const wrapper = mount(OpenStreetMapStep)
  await flushPromises()
  expect(wrapper.emitted('complete')).toBeUndefined()
  wrapper.unmount()
})
