import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ColorPicker from './ColorPicker.vue'

/**
 * The eyedropper is the browser's own — it takes over the screen so it can
 * read pixels the page has no business seeing, including outside the window.
 * Only Chromium has it, so the interesting cases are that it's used where it
 * exists and not offered where it doesn't.
 */

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: {
    'en-US': {
      colorPicker: {
        label: 'Color',
        custom: 'Custom color',
        sample: 'Pick a color from the screen',
        apply: 'Apply',
      },
      colors: { teal: 'Teal', cobalt: 'Cobalt' },
    },
  },
})

function picker(props: Record<string, unknown> = {}) {
  return mount(ColorPicker, {
    props: { modelValue: 'teal', ...props },
    global: { plugins: [i18n], stubs: { teleport: true } },
  })
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).EyeDropper
})

describe('ColorPicker', () => {
  it('offers the eyedropper only where the browser has one', () => {
    expect(picker().vm.eyeDropper).toBeUndefined()

    ;(window as unknown as Record<string, unknown>).EyeDropper = class {
      open = async () => ({ sRGBHex: '#123456' })
    }
    expect(picker().vm.eyeDropper).toBeDefined()
  })

  it('takes the colour the eyedropper sampled', async () => {
    const open = vi.fn(async () => ({ sRGBHex: '#abcdef' }))
    ;(window as unknown as Record<string, unknown>).EyeDropper = class {
      open = open
    }
    const wrapper = picker()

    await wrapper.vm.sampleFromScreen()

    expect(open).toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['#abcdef'])
  })

  it('treats a dismissed eyedropper as nothing happening', async () => {
    ;(window as unknown as Record<string, unknown>).EyeDropper = class {
      open = async () => {
        // Escape rejects rather than resolving; that isn't an error.
        throw new DOMException('aborted', 'AbortError')
      }
    }
    const wrapper = picker()

    await expect(wrapper.vm.sampleFromScreen()).resolves.toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
