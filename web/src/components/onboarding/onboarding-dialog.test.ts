import { beforeEach, expect, test, vi } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import OnboardingDialog from './OnboardingDialog.vue'

const mocks = vi.hoisted(() => ({ post: vi.fn(), updateUser: vi.fn(), goToStashedPath: vi.fn() }))
const billingEnabled = ref(false)
const hasSubscription = ref(false)
const integrations = reactive<{ osmProfile: object | null }>({ osmProfile: null })
vi.mock('@/stores/integrations.store', () => ({ useIntegrationsStore: () => integrations }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ me: { id: '1' }, updateUser: mocks.updateUser, goToStashedPath: mocks.goToStashedPath }) }))
vi.mock('@/services/subscription.service', () => ({ useSubscriptionService: () => ({ billingEnabled, hasSubscription }) }))
vi.mock('@/lib/api', () => ({ api: { post: mocks.post } }))
vi.mock('@/lib/toast', () => ({ toast: {} }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({}), useRoute: () => ({ query: {} }) }))
vi.mock('./OnboardingCompletion.vue', () => ({ default: { name: 'OnboardingCompletion' } }))
vi.mock('./ProfileSetupStep.vue', () => ({ default: { name: 'ProfileSetupStep' } }))
vi.mock('./ThemeStep.vue', () => ({ default: { name: 'ThemeStep' } }))
vi.mock('./RecoveryKeyStep.vue', () => ({ default: { name: 'RecoveryKeyStep' } }))
vi.mock('./PasskeyStep.vue', () => ({ default: { name: 'PasskeyStep' } }))
vi.mock('./OpenStreetMapStep.vue', () => ({ default: { name: 'OpenStreetMapStep' } }))
vi.mock('./SubscriptionStep.vue', () => ({ default: { name: 'SubscriptionStep' } }))
vi.mock('./IntegrationsSetupStep.vue', () => ({ default: { name: 'IntegrationsSetupStep' } }))

function mountDialog() {
  return shallowMount(OnboardingDialog, { global: { renderStubDefaultSlot: true, stubs: { Button: { template: '<button><slot /></button>' } } } })
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('onboarding-step', 'openstreetmap')
  billingEnabled.value = false
  hasSubscription.value = false
  integrations.osmProfile = null
  mocks.post.mockResolvedValue({ data: { onboardingCompletedAt: '2026-10-29' } })
})
test('offers OpenStreetMap on a free server and lets users finish without connecting', async () => {
  const wrapper = mountDialog()
  expect(wrapper.findComponent({ name: 'OpenStreetMapStep' }).exists()).toBe(true)
  const skip = wrapper.findAll('button').find(button => button.text() === 'onboarding.openstreetmap.skip')!
  expect(skip).toBeDefined()
  await skip.trigger('click')
  await flushPromises()
  await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/users/me/onboarding/complete'))
  expect(mocks.goToStashedPath).not.toHaveBeenCalled()
  wrapper.findComponent({ name: 'OnboardingCompletion' }).vm.$emit('reveal')
  expect(mocks.goToStashedPath).toHaveBeenCalledOnce()
  expect(localStorage.getItem('onboarding-step')).toBeNull()
  wrapper.unmount()
})
test('continues to subscription choices when billing is enabled', async () => {
  billingEnabled.value = true
  const wrapper = mountDialog()
  const skip = wrapper.findAll('button').find(button => button.text() === 'onboarding.openstreetmap.skip')!
  await skip.trigger('click')
  expect(wrapper.findComponent({ name: 'SubscriptionStep' }).exists()).toBe(true)
  expect(mocks.post).not.toHaveBeenCalled()
  expect(localStorage.getItem('onboarding-step')).toBe('subscription')
  wrapper.unmount()
})
test('replaces skip with finish when the account connects', async () => {
  const wrapper = mountDialog()
  integrations.osmProfile = { osmDisplayName: 'Mapper' }
  await flushPromises()
  expect(wrapper.text()).not.toContain('onboarding.openstreetmap.skip')
  expect(wrapper.text()).toContain('onboarding.finish')
  wrapper.unmount()
})

test('advances to subscription choices after OpenStreetMap connects', async () => {
  billingEnabled.value = true
  const wrapper = mountDialog()
  wrapper.findComponent({ name: 'OpenStreetMapStep' }).vm.$emit('complete')
  await flushPromises()
  expect(wrapper.findComponent({ name: 'SubscriptionStep' }).exists()).toBe(true)
  expect(localStorage.getItem('onboarding-step')).toBe('subscription')
  expect(mocks.post).not.toHaveBeenCalled()
  wrapper.unmount()
})

test('finishes onboarding after OpenStreetMap connects on a free server', async () => {
  const wrapper = mountDialog()
  wrapper.findComponent({ name: 'OpenStreetMapStep' }).vm.$emit('complete')
  await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/users/me/onboarding/complete'))
  expect(mocks.goToStashedPath).not.toHaveBeenCalled()
  wrapper.findComponent({ name: 'OnboardingCompletion' }).vm.$emit('reveal')
  expect(mocks.goToStashedPath).toHaveBeenCalledOnce()
  wrapper.unmount()
})

test('clearly offers skipping passkey setup while continuing onboarding', async () => {
  localStorage.setItem('onboarding-step', 'passkey')
  const wrapper = mountDialog()
  const skip = wrapper.findAll('button').find(button => button.text() === 'settings.identity.recoveryKey.passkeyOffer.skipForNow')!
  await skip.trigger('click')
  expect(wrapper.findComponent({ name: 'OpenStreetMapStep' }).exists()).toBe(true)
  expect(localStorage.getItem('onboarding-step')).toBe('openstreetmap')
  wrapper.unmount()
})

test('keeps the completion overlay until the map is revealed and the animation finishes', async () => {
  const wrapper = mountDialog()
  const skip = wrapper.findAll('button').find(button => button.text() === 'onboarding.openstreetmap.skip')!
  await skip.trigger('click')
  await vi.waitFor(() => expect(wrapper.findComponent({ name: 'OnboardingCompletion' }).exists()).toBe(true))
  expect(wrapper.emitted('finishing')).toEqual([[true]])
  expect(mocks.updateUser).not.toHaveBeenCalled()
  expect(mocks.goToStashedPath).not.toHaveBeenCalled()
  const completion = wrapper.findComponent({ name: 'OnboardingCompletion' })
  completion.vm.$emit('reveal')
  completion.vm.$emit('reveal')
  expect(mocks.updateUser).toHaveBeenCalledTimes(1)
  expect(mocks.goToStashedPath).toHaveBeenCalledTimes(1)
  expect(wrapper.emitted('complete')).toBeUndefined()
  completion.vm.$emit('complete')
  completion.vm.$emit('complete')
  expect(wrapper.emitted('complete')).toHaveLength(1)
  wrapper.unmount()
})

test('prevents repeated completion requests while saving', async () => {
  mocks.post.mockReturnValue(new Promise(() => {}))
  const wrapper = mountDialog()
  const skip = wrapper.findAll('button').find(button => button.text() === 'onboarding.openstreetmap.skip')!
  await skip.trigger('click')
  await skip.trigger('click')
  expect(wrapper.emitted('finishing')).toEqual([[true]])
  await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce())
  wrapper.unmount()
})
