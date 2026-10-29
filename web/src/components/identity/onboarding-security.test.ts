import { beforeEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import RecoveryKeySetupContent from './RecoveryKeySetupContent.vue'
import PasskeyOfferContent from './PasskeyOfferContent.vue'

const mocks = vi.hoisted(() => ({ complete: vi.fn(), copy: vi.fn(), passkeys: vi.fn(), enroll: vi.fn(), enrollExisting: vi.fn(), refresh: vi.fn() }))
const identity = reactive({
  pendingRecoveryKey: ref<string | null>('DEMO0DEMO0DEMO0'),
  isLoading: ref(false),
  passkeySlotCredentialIds: ref(new Set<string>()),
  completeSetup: mocks.complete,
  refreshSlotAvailability: mocks.refresh,
  enrollPasskey: mocks.enroll,
  enrollExistingPasskey: mocks.enrollExisting,
})
vi.mock('@/stores/identity.store', () => ({ useIdentityStore: () => identity }))
vi.mock('@/services/auth.service', () => ({ useAuthService: () => ({ getPasskeys: mocks.passkeys }) }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copied: ref(false), copy: mocks.copy }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

beforeEach(() => {
  vi.clearAllMocks()
  identity.pendingRecoveryKey = 'DEMO0DEMO0DEMO0'
  identity.passkeySlotCredentialIds = new Set()
  mocks.complete.mockResolvedValue({ success: true })
  mocks.passkeys.mockResolvedValue([])
  mocks.enroll.mockResolvedValue({ success: true, slotCreated: true })
  mocks.enrollExisting.mockResolvedValue({ success: true, slotCreated: true })
})

test('copies the full raw recovery key and requires confirmation before saving', async () => {
  const wrapper = mount(RecoveryKeySetupContent)
  expect(wrapper.get('code').text()).toBe('DEMO0 DEMO0 DEMO0')
  const buttons = wrapper.findAll('button')
  const copy = buttons.find(button => button.text().includes('copyToClipboard'))!
  const confirm = buttons.find(button => button.text() === 'general.continue')!
  expect(confirm.attributes('disabled')).toBeDefined()
  await copy.trigger('click')
  expect(mocks.copy).toHaveBeenCalledWith('DEMO0DEMO0DEMO0', 'settings.identity.recoveryKey.setup.keyCopiedToast')
  expect(mocks.complete).not.toHaveBeenCalled()
  await wrapper.get('[role="checkbox"]').trigger('click')
  await confirm.trigger('click')
  await flushPromises()
  expect(mocks.complete).toHaveBeenCalledOnce()
  expect(wrapper.emitted('confirm')).toHaveLength(1)
  wrapper.unmount()
})

test('keeps recovery confirmation disabled while the key is generating', () => {
  identity.pendingRecoveryKey = null
  const wrapper = mount(RecoveryKeySetupContent)
  expect(wrapper.get('[role="checkbox"]').attributes('disabled')).toBeDefined()
  expect(wrapper.findAll('button').find(button => button.text().includes('copyToClipboard'))!.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

test('keeps setup errors visible without completing', async () => {
  mocks.complete.mockResolvedValue({ success: false, error: 'Could not save' })
  const wrapper = mount(RecoveryKeySetupContent)
  await wrapper.get('[role="checkbox"]').trigger('click')
  await wrapper.findAll('button').find(button => button.text() === 'general.continue')!.trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Could not save')
  expect(wrapper.emitted('confirm')).toBeUndefined()
  wrapper.unmount()
})

test('completes passkey setup only after a recovery slot is created', async () => {
  const wrapper = mount(PasskeyOfferContent, { props: { hideIntro: true, hideSkip: true } })
  await flushPromises()
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(mocks.enroll).toHaveBeenCalledOnce()
  expect(wrapper.emitted('complete')).toHaveLength(1)
  wrapper.unmount()
})

test('does not advance when the passkey prompt is cancelled', async () => {
  mocks.enroll.mockResolvedValue({ cancelled: true })
  const wrapper = mount(PasskeyOfferContent, { props: { hideIntro: true, hideSkip: true } })
  await flushPromises()
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(wrapper.emitted('complete')).toBeUndefined()
  expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

test('offers an existing passkey and preserves the option to create another', async () => {
  mocks.passkeys.mockResolvedValue([{ id: 'existing', name: 'My phone' }])
  const wrapper = mount(PasskeyOfferContent, { props: { hideIntro: true, hideSkip: true } })
  await flushPromises()
  expect(wrapper.text()).toContain('My phone')
  expect(wrapper.findAll('button')).toHaveLength(2)
  await wrapper.findAll('button')[0].trigger('click')
  await flushPromises()
  expect(mocks.enrollExisting).toHaveBeenCalledWith('existing')
  expect(wrapper.emitted('complete')).toHaveLength(1)
  wrapper.unmount()
})
