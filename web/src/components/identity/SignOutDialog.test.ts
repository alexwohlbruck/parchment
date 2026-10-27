import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SignOutDialog from './SignOutDialog.vue'

const { fetchRecoveryKey, copy } = vi.hoisted(() => ({
  fetchRecoveryKey: vi.fn(),
  copy: vi.fn(),
}))
vi.mock('@/stores/identity.store', () => ({
  useIdentityStore: () => ({ fetchRecoveryKey }),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/composables/useClipboard', async () => {
  const { ref } = await import('vue')
  return { useClipboard: () => ({ copied: ref(false), copy }) }
})

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.clearAllMocks()
})

function mountDialog() {
  const wrapper = mount(SignOutDialog, {
    props: { title: 'Sign out?', continueText: 'Sign out', destructive: true },
    global: {
      stubs: {
        ConfirmDialog: {
          template: '<div><slot /><button @click="$emit(\'submit\', false)">Cancel</button><button @click="$emit(\'submit\', true)">Sign out</button></div>',
        },
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('sign-out recovery key', () => {
  it('shows the saved key in groups and copies the original key without confirming sign-out', async () => {
    const key = 'abcdefghij1234567890'
    fetchRecoveryKey.mockResolvedValue(key)
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('abcde fghij 12345 67890')
    const copyButton = wrapper.findAll('button').find(button => button.text().includes('copyToClipboard'))!
    await copyButton.trigger('click')
    expect(copy).toHaveBeenCalledWith(key, 'settings.identity.recoveryKey.setup.keyCopiedToast')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('keeps cancellation and sign-out available when no local key exists', async () => {
    fetchRecoveryKey.mockResolvedValue(null)
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).not.toContain('copyToClipboard')
    await wrapper.findAll('button')[0].trigger('click')
    await wrapper.findAll('button')[1].trigger('click')
    expect(wrapper.emitted('submit')).toEqual([[false], [true]])
  })
})
