import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import Otp from './Otp.vue'

const { signIn, verifyEmail } = vi.hoisted(() => ({
  signIn: vi.fn().mockResolvedValue(undefined),
  verifyEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/auth.service', () => ({ useAuthService: () => ({ signIn, verifyEmail }) }))
vi.mock('@/lib/api', () => ({ api: { defaults: {} } }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  signIn.mockClear()
  verifyEmail.mockReset().mockResolvedValue(undefined)
  vi.useRealTimers()
})

function mountOtp() {
  const wrapper = mount(Otp, { props: { email: 'test@example.com' }, attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}

async function paste(wrapper: ReturnType<typeof mount>, text: string, index = 0) {
  const inputs = wrapper.findAll('input[autocomplete="one-time-code"]')
  await inputs[index].trigger('paste', { clipboardData: { getData: () => text } })
  await flushPromises()
  return inputs.map(input => (input.element as HTMLInputElement).value).join('')
}

describe('OTP entry', () => {
  it.each([' 01234567', '\u00a001234567\n', ' 0123 4567 ', '01-23-45-67'])('pastes %j as eight digits without losing leading zeroes', async text => {
    const wrapper = mountOtp()
    expect(await paste(wrapper, text)).toBe('01234567')
    expect(signIn).toHaveBeenCalledExactlyOnceWith('test@example.com', '01234567')
  })

  it('requests a numeric keyboard while retaining one-time-code autofill', () => {
    const wrapper = mountOtp()
    const inputs = wrapper.findAll('input[autocomplete="one-time-code"]')
    expect(inputs).toHaveLength(8)
    for (const input of inputs) {
      expect(input.attributes('inputmode')).toBe('numeric')
      expect(input.attributes('pattern')).toBe('[0-9]*')
    }
  })

  it('continues a partial paste from the current box', async () => {
    const wrapper = mountOtp()
    expect(await paste(wrapper, '01')).toBe('01')
    expect(signIn).not.toHaveBeenCalled()
    expect(await paste(wrapper, ' 234 567 ', 2)).toBe('01234567')
    expect(signIn).toHaveBeenCalledExactlyOnceWith('test@example.com', '01234567')
  })

  it('replaces the whole code when pasted into a later box', async () => {
    const wrapper = mountOtp()
    await paste(wrapper, '12')
    expect(await paste(wrapper, ' 00123456 ', 2)).toBe('00123456')
    expect(signIn).toHaveBeenCalledExactlyOnceWith('test@example.com', '00123456')
  })

  it('ignores a paste with no digits and never submits it', async () => {
    const wrapper = mountOtp()
    expect(await paste(wrapper, ' \nletters\t')).toBe('')
    expect(signIn).not.toHaveBeenCalled()
  })
})


describe('resending the email', () => {
  it('sends once while pending, clears the old code, and permits another resend after the cooldown', async () => {
    vi.useFakeTimers()
    let resolveSend!: () => void
    verifyEmail.mockImplementationOnce(() => new Promise<void>(resolve => { resolveSend = resolve }))
    const wrapper = mountOtp()
    await paste(wrapper, '12')
    const button = wrapper.findAll('button').find(button => button.text() === 'auth.otp.resend')!
    expect(button.attributes('type')).toBe('button')
    await button.trigger('click')
    expect(verifyEmail).toHaveBeenCalledExactlyOnceWith('test@example.com')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.text()).toBe('auth.otp.resending')
    await button.trigger('click')
    expect(verifyEmail).toHaveBeenCalledTimes(1)
    resolveSend()
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('auth.otp.resent')
    expect(wrapper.find('[aria-invalid="true"]').exists()).toBe(false)
    expect(wrapper.findAll('input[autocomplete="one-time-code"]').every(input => !(input.element as HTMLInputElement).value)).toBe(true)
    expect(signIn).not.toHaveBeenCalled()
    expect(button.attributes('disabled')).toBeDefined()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(button.attributes('disabled')).toBeUndefined()
    await button.trigger('click')
    await flushPromises()
    expect(verifyEmail).toHaveBeenCalledTimes(2)
  })

  it('shows an error, keeps the existing code, and permits an immediate retry', async () => {
    verifyEmail.mockRejectedValueOnce(new Error('Network error'))
    const wrapper = mountOtp()
    await paste(wrapper, '12')
    const button = wrapper.findAll('button').find(button => button.text() === 'auth.otp.resend')!
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('auth.otp.resendFailed')
    expect(button.attributes('disabled')).toBeUndefined()
    expect((wrapper.get('input[autocomplete="one-time-code"]').element as HTMLInputElement).value).toBe('1')
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toBe('auth.otp.resent')
    expect(wrapper.find('[aria-invalid="true"]').exists()).toBe(false)
  })
})
