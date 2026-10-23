import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { Toaster } from 'vue-sonner'
import { toast } from './toast'
import { _resetConnectivityForTests } from './connectivity'

let wrapper: VueWrapper
const settle = async () => { await nextTick(); await nextTick() }
const visible = () => document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])')

beforeEach(() => {
  vi.useFakeTimers()
  _resetConnectivityForTests()
  wrapper = mount(Toaster, { attachTo: document.body, props: { duration: 1000, closeButton: true } })
})
afterEach(() => {
  toast.dismiss()
  wrapper.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('toast lifecycle', () => {
  it('renders one notification for repeated Unicode messages and can show it after expiry', async () => {
    toast.info('已复制 📋')
    toast.info('已复制 📋')
    await settle()
    expect(visible()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1300)
    expect(visible()).toHaveLength(0)
    toast.info('已复制 📋')
    await settle()
    expect(visible()).toHaveLength(1)
  })

  it('can show a notification again after programmatic dismissal', async () => {
    const id = toast.info('Programmatic dismissal')
    await settle()
    toast.dismiss(id)
    await settle()
    await vi.advanceTimersByTimeAsync(300)
    toast.info('Programmatic dismissal')
    await settle()
    expect(visible()).toHaveLength(1)
  })

  it('replaces a keyed action and removes it when the next update has no action', async () => {
    const oldAction = vi.fn()
    const newAction = vi.fn()
    toast.success('Saved', { id: 'action-lifecycle', action: { label: 'Old', onClick: oldAction } })
    await settle()
    toast.success('Saved again', { id: 'action-lifecycle', action: { label: 'New', onClick: newAction } })
    await settle()
    expect(document.body.textContent).not.toContain('Old')
    expect(document.body.textContent).toContain('New')
    toast.error('Failed', { id: 'action-lifecycle' })
    await settle()
    expect(document.querySelector('[data-button]')).toBeNull()
    expect(visible()).toHaveLength(1)
  })

  it('keeps different action targets separate and lets an action toast reappear', async () => {
    const first = vi.fn()
    toast.success('Saved', { id: 'collection:one', action: { label: 'View one', onClick: first } })
    toast.success('Saved', { id: 'collection:two', action: { label: 'View two', onClick: vi.fn() } })
    await settle()
    expect(visible()).toHaveLength(2)
    const button = [...document.querySelectorAll<HTMLButtonElement>('[data-button]')].find(b => b.textContent === 'View one')!
    button.click()
    await settle()
    expect(first).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(300)
    toast.success('Saved', { id: 'collection:one', action: { label: 'View one', onClick: first } })
    await settle()
    expect(visible()).toHaveLength(2)
  })

  it('pulses repeats without changing the position transform and respects reduced motion', async () => {
    toast.info('Pulse')
    await settle()
    const element = visible()[0] as HTMLElement
    const animate = vi.fn()
    element.animate = animate
    toast.info('Pulse')
    expect(animate).toHaveBeenCalledOnce()
    expect(animate.mock.calls[0][0][1]).toEqual({ scale: 0.97 })
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    toast.info('Pulse')
    expect(animate).toHaveBeenCalledOnce()
  })
})
