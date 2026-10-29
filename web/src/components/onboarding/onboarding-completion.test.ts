import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mount, enableAutoUnmount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import OnboardingCompletion from './OnboardingCompletion.vue'

const reducedMotion = ref(false)
vi.mock('@vueuse/core', () => ({ useMediaQuery: () => reducedMotion }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
enableAutoUnmount(afterEach)
beforeEach(() => { vi.useFakeTimers(); reducedMotion.value = false })
afterEach(() => vi.useRealTimers())

test('reveals the map beneath the overlay before finishing', async () => {
  const wrapper = mount(OnboardingCompletion)
  await vi.advanceTimersByTimeAsync(799)
  expect(wrapper.emitted('reveal')).toBeUndefined()
  await vi.advanceTimersByTimeAsync(1)
  expect(wrapper.emitted('reveal')).toHaveLength(1)
  expect(wrapper.emitted('complete')).toBeUndefined()
  await vi.advanceTimersByTimeAsync(800)
  expect(wrapper.emitted('complete')).toHaveLength(1)
  expect(wrapper.emitted('reveal')).toHaveLength(1)
})

test('finishes immediately when reduced motion is preferred', () => {
  reducedMotion.value = true
  const wrapper = mount(OnboardingCompletion)
  expect(wrapper.emitted('reveal')).toHaveLength(1)
  expect(wrapper.emitted('complete')).toHaveLength(1)
})

test('responds when reduced motion is enabled during the animation', async () => {
  const wrapper = mount(OnboardingCompletion)
  reducedMotion.value = true
  await nextTick()
  expect(wrapper.emitted('complete')).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(2000)
  expect(wrapper.emitted('complete')).toHaveLength(1)
  expect(wrapper.emitted('reveal')).toHaveLength(1)
})

test('cancels pending navigation and completion when unmounted', async () => {
  const wrapper = mount(OnboardingCompletion)
  wrapper.unmount()
  await vi.advanceTimersByTimeAsync(2000)
  expect(wrapper.emitted('reveal')).toBeUndefined()
  expect(wrapper.emitted('complete')).toBeUndefined()
})
