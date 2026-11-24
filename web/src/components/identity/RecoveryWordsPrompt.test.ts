import { beforeEach, expect, test, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive, ref, nextTick } from 'vue'
import RecoveryWordsPrompt from './RecoveryWordsPrompt.vue'

const identity = reactive({
  identity: ref<{ signingKey: string } | null>({ signingKey: 'sign-1' }),
  isLoading: ref(false),
  isSetupComplete: ref(true),
  isStale: ref(false),
  hasSavedRecoveryWords: ref<boolean | undefined>(false),
})
vi.mock('@/stores/identity.store', () => ({ useIdentityStore: () => identity }))
vi.mock('./RecoveryWordsDialog.vue', () => ({
  default: { name: 'RecoveryWordsDialog', props: ['open', 'mode'], emits: ['update:open'], template: '<div />' },
}))

const dialogOpen = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findComponent({ name: 'RecoveryWordsDialog' }).props('open')

beforeEach(() => {
  sessionStorage.clear()
  Object.assign(identity, {
    identity: { signingKey: 'sign-1' },
    isLoading: false,
    isSetupComplete: true,
    isStale: false,
    hasSavedRecoveryWords: false,
  })
})

test('shows the words to an account that has not confirmed them', async () => {
  const wrapper = mount(RecoveryWordsPrompt)
  await flushPromises()
  expect(dialogOpen(wrapper)).toBe(true)
})

test('stays closed while the device is still loading or holds outdated keys', async () => {
  identity.isLoading = true
  const wrapper = mount(RecoveryWordsPrompt)
  await nextTick()
  expect(dialogOpen(wrapper)).toBe(false)

  identity.isStale = true
  identity.isLoading = false
  await nextTick()
  expect(dialogOpen(wrapper)).toBe(false)
})

test('closes when the device learns its keys are outdated', async () => {
  const wrapper = mount(RecoveryWordsPrompt)
  await nextTick()
  identity.isStale = true
  await nextTick()
  expect(dialogOpen(wrapper)).toBe(false)
})

test('closing it skips the rest of the session, until the keys change', async () => {
  const wrapper = mount(RecoveryWordsPrompt)
  await nextTick()
  await wrapper.findComponent({ name: 'RecoveryWordsDialog' }).vm.$emit('update:open', false)
  await nextTick()

  identity.isLoading = true
  await nextTick()
  identity.isLoading = false
  await nextTick()
  expect(dialogOpen(wrapper)).toBe(false)

  identity.identity = { signingKey: 'sign-2' }
  await nextTick()
  expect(dialogOpen(wrapper)).toBe(true)
})

test('stays closed once the words are confirmed', async () => {
  identity.hasSavedRecoveryWords = true
  const wrapper = mount(RecoveryWordsPrompt)
  await nextTick()
  expect(dialogOpen(wrapper)).toBe(false)
})
