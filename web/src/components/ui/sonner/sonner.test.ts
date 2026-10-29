import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { DialogRoot, DialogContent, DialogTitle } from 'reka-ui'
import { DrawerRoot, DrawerContent, DrawerTitle } from '@alexwohlbruck/vaul-vue'
import { toast } from 'vue-sonner'
import Toaster from './Sonner.vue'

enableAutoUnmount(afterEach)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

for (const kind of ['dialog', 'drawer'] as const) {
  describe(`toasts over a modal ${kind}`, () => {
    function setup() {
      const onOpenChange = vi.fn()
      const [Root, Content, Title] = kind === 'dialog'
        ? [DialogRoot, DialogContent, DialogTitle]
        : [DrawerRoot, DrawerContent, DrawerTitle]
      const wrapper = mount(defineComponent({
        setup: () => () => h('div', [
          h(Root, { open: true, 'onUpdate:open': onOpenChange }, {
            default: () => h(Content, { 'aria-describedby': undefined }, {
              default: () => h(Title, {}, () => 'Modal content'),
            }),
          }),
          h(Toaster, { duration: Infinity, closeButton: true, position: 'bottom-center' }),
        ]),
      }), { attachTo: document.body })
      return { wrapper, onOpenChange }
    }

    test('allows swiping the toast without dismissing the overlay', async () => {
      const { wrapper, onOpenChange } = setup()
      const onDismiss = vi.fn()
      toast.success('Saved', { onDismiss })
      await flushPromises()
      const title = wrapper.get('[data-sonner-toast] [data-title]')
      await title.trigger('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 100 })
      await title.trigger('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 200 })
      await title.trigger('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 200 })
      expect(onDismiss).toHaveBeenCalledOnce()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
      expect(document.querySelector('[role="dialog"]')).not.toBeNull()
      wrapper.unmount()
    })

    test('keeps toast actions and close buttons working without closing the overlay', async () => {
      const { wrapper, onOpenChange } = setup()
      const onAction = vi.fn()
      const onDismiss = vi.fn()
      toast.success('Saved', { action: { label: 'Undo', onClick: onAction } })
      await flushPromises()
      const action = wrapper.get('[data-sonner-toast] [data-button]')
      await action.trigger('pointerdown', { pointerId: 1, pointerType: 'mouse' })
      await action.trigger('click')
      expect(onAction).toHaveBeenCalledOnce()
      toast.success('Another save', { onDismiss })
      await flushPromises()
      const close = wrapper.get('[data-sonner-toast]:first-child [data-close-button]')
      await close.trigger('pointerdown', { pointerId: 2, pointerType: 'mouse' })
      await close.trigger('click')
      expect(onDismiss).toHaveBeenCalledOnce()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
      wrapper.unmount()
    })

    test('keeps toast touch gestures away from the document scroll lock', async () => {
      const { wrapper } = setup()
      toast.success('Saved')
      await flushPromises()
      const listener = vi.fn()
      document.addEventListener('touchmove', listener)
      try {
        await wrapper.get('[data-sonner-toast]').trigger('touchmove')
        expect(listener).not.toHaveBeenCalled()
      } finally {
        document.removeEventListener('touchmove', listener)
        wrapper.unmount()
      }
    })
  })
}
