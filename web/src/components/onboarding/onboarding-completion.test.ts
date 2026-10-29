import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import OnboardingCompletion from './OnboardingCompletion.vue'

const mocks = vi.hoisted(() => ({ capture: vi.fn() }))
const reducedMotion = ref(false)
const isMapReady = ref(false)
const frame = { image: 'data:image/webp;base64,bWFw', left: 24, top: 10, width: 390, height: 844 }
vi.mock('@vueuse/core', () => ({ useMediaQuery: () => reducedMotion }))
vi.mock('@/services/map/map.service', () => ({ useMapService: () => ({ isMapReady, captureSnapshot: mocks.capture }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  reducedMotion.value = false
  isMapReady.value = false
  mocks.capture.mockResolvedValue(frame)
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test('opens the destination immediately, then unfolds its actual map frame', async () => {
  const wrapper = mount(OnboardingCompletion, { global: { stubs: { teleport: true } } })
  expect(wrapper.emitted('reveal')).toHaveLength(1)
  expect(mocks.capture).not.toHaveBeenCalled()
  isMapReady.value = true
  await flushPromises()
  expect(mocks.capture).toHaveBeenCalledOnce()
  const paper = wrapper.get('.paper-map')
  expect(paper.attributes('style')).toContain(frame.image)
  expect(paper.attributes('style')).toContain('left: 24px')
  expect(paper.attributes('style')).toContain('height: 844px')
  expect(wrapper.findAll('.map-panel')).toHaveLength(3)
  expect(wrapper.emitted('complete')).toBeUndefined()
  await vi.advanceTimersByTimeAsync(2400)
  expect(wrapper.emitted('complete')).toHaveLength(1)
})

test('does not capture or animate when reduced motion is preferred', () => {
  reducedMotion.value = true
  const wrapper = mount(OnboardingCompletion)
  expect(wrapper.emitted('reveal')).toHaveLength(1)
  expect(wrapper.emitted('complete')).toHaveLength(1)
  expect(mocks.capture).not.toHaveBeenCalled()
})

test('never blocks onboarding indefinitely while the map is loading', async () => {
  const wrapper = mount(OnboardingCompletion)
  await vi.advanceTimersByTimeAsync(3500)
  expect(wrapper.emitted('complete')).toHaveLength(1)
  expect(mocks.capture).not.toHaveBeenCalled()
})

test('falls through to the live map when capture fails', async () => {
  mocks.capture.mockResolvedValue(null)
  isMapReady.value = true
  const wrapper = mount(OnboardingCompletion)
  await flushPromises()
  expect(wrapper.emitted('complete')).toHaveLength(1)
})

test('aborts a pending capture when reduced motion is enabled', async () => {
  mocks.capture.mockReturnValue(new Promise(() => {}))
  isMapReady.value = true
  const wrapper = mount(OnboardingCompletion)
  const signal = mocks.capture.mock.calls[0][0] as AbortSignal
  reducedMotion.value = true
  await nextTick()
  expect(signal.aborted).toBe(true)
  expect(wrapper.emitted('complete')).toHaveLength(1)
})

test('does not animate a frame that resolves after unmounting', async () => {
  let resolve!: (value: typeof frame) => void
  mocks.capture.mockReturnValue(new Promise(done => { resolve = done }))
  isMapReady.value = true
  const wrapper = mount(OnboardingCompletion)
  const signal = mocks.capture.mock.calls[0][0] as AbortSignal
  wrapper.unmount()
  resolve(frame)
  await flushPromises()
  expect(signal.aborted).toBe(true)
  expect(wrapper.emitted('complete')).toBeUndefined()
})

test('finishes cleanly if the viewport changes during the fold', async () => {
  isMapReady.value = true
  const wrapper = mount(OnboardingCompletion)
  await flushPromises()
  window.dispatchEvent(new Event('resize'))
  expect(wrapper.emitted('complete')).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(4000)
  expect(wrapper.emitted('complete')).toHaveLength(1)
})
