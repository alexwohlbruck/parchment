import { beforeEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import RecoveryWordsSetupContent from './RecoveryWordsSetupContent.vue'
import PasskeyOfferContent from './PasskeyOfferContent.vue'

const mocks = vi.hoisted(() => ({ complete: vi.fn(), copy: vi.fn(), passkeys: vi.fn(), enroll: vi.fn(), enrollExisting: vi.fn(), refresh: vi.fn() }))
const identity = reactive({
  pendingRecoveryWords: ref<string[] | null>(null),
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
  identity.pendingRecoveryWords = WORDS
  identity.passkeySlotCredentialIds = new Set()
  mocks.complete.mockResolvedValue({ success: true })
  mocks.passkeys.mockResolvedValue([])
  mocks.enroll.mockResolvedValue({ success: true, slotCreated: true })
  mocks.enrollExisting.mockResolvedValue({ success: true, slotCreated: true })
})

const WORDS = Array.from({ length: 24 }, (_, i) => `word${i + 1}`)

async function passWordCheck(wrapper: ReturnType<typeof mount>) {
  await wrapper.findAll('button').find(button => button.text() === 'settings.identity.recoveryKey.check.start')!.trigger('click')
  const labels = wrapper.findAll('label')
  expect(labels).toHaveLength(3)
  for (const label of labels) {
    // The i18n mock renders the key, so the asked position comes from which word unlocks it.
    const input = label.get('input')
    for (const word of WORDS) {
      await input.setValue(word)
      if (label.find('svg').exists()) break
    }
  }
}

test('copies the words as one phrase and saves only after 3 are retyped', async () => {
  const wrapper = mount(RecoveryWordsSetupContent)
  expect(wrapper.findAll('li')).toHaveLength(24)
  await wrapper.findAll('button').find(button => button.text().includes('copyToClipboard'))!.trigger('click')
  expect(mocks.copy).toHaveBeenCalledWith(WORDS.join(' '), 'settings.identity.recoveryKey.setup.keyCopiedToast')

  await wrapper.findAll('button').find(button => button.text() === 'settings.identity.recoveryKey.check.start')!.trigger('click')
  expect(wrapper.findAll('li')).toHaveLength(0)
  const confirm = () => wrapper.findAll('button').find(button => button.text() === 'general.continue')!
  expect(confirm().attributes('disabled')).toBeDefined()
  await wrapper.findAll('input')[0].setValue('not-the-word')
  expect(confirm().attributes('disabled')).toBeDefined()
  expect(mocks.complete).not.toHaveBeenCalled()

  await wrapper.findAll('button').find(button => button.text() === 'settings.identity.recoveryKey.check.showAgain')!.trigger('click')
  await passWordCheck(wrapper)
  await confirm().trigger('click')
  await flushPromises()
  expect(mocks.complete).toHaveBeenCalledOnce()
  expect(wrapper.emitted('confirm')).toHaveLength(1)
  wrapper.unmount()
})

test('keeps the word check out of reach while the words are generating', () => {
  identity.pendingRecoveryWords = null
  const wrapper = mount(RecoveryWordsSetupContent)
  const buttons = wrapper.findAll('button')
  expect(buttons.find(button => button.text() === 'settings.identity.recoveryKey.check.start')!.attributes('disabled')).toBeDefined()
  expect(buttons.find(button => button.text().includes('copyToClipboard'))!.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

test('keeps setup errors visible without completing', async () => {
  mocks.complete.mockResolvedValue({ success: false, error: 'Could not save' })
  const wrapper = mount(RecoveryWordsSetupContent)
  await passWordCheck(wrapper)
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
