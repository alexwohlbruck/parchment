import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import mousetrap from 'mousetrap'
import { useHotkeys } from './useHotkeys'

/**
 * Several components bind the same key at once — `esc` is bound by the left
 * sheet, the bottom sheet and whatever view is open over them. Mousetrap
 * unbinds a whole key rather than one callback, so the interesting case is
 * what survives when one of those components goes away.
 */

/** Press a key the way mousetrap sees it. */
function press(key: string, keyCode: number, modifiers: Partial<KeyboardEvent> = {}) {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    } as KeyboardEventInit),
  )
}

function binder(key: string, handler: () => void) {
  return defineComponent({
    setup() {
      useHotkeys([{ key, handler, preventDefault: false }])
      return () => null
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  mousetrap.reset()
})

describe('useHotkeys', () => {
  it('runs the handler for a key', () => {
    const handler = vi.fn()
    const wrapper = mount(binder('esc', handler))

    press('Escape', 27)

    expect(handler).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('runs every component bound to the same key', () => {
    const sheet = vi.fn()
    const view = vi.fn()
    const a = mount(binder('esc', sheet))
    const b = mount(binder('esc', view))

    press('Escape', 27)

    expect(sheet).toHaveBeenCalledTimes(1)
    expect(view).toHaveBeenCalledTimes(1)
    a.unmount()
    b.unmount()
  })

  it('leaves the other handlers alone when one component unmounts', () => {
    const sheet = vi.fn()
    const view = vi.fn()
    const a = mount(binder('esc', sheet))
    const b = mount(binder('esc', view))

    // The view closes; the sheet underneath still has to answer Escape.
    b.unmount()
    press('Escape', 27)

    expect(view).not.toHaveBeenCalled()
    expect(sheet).toHaveBeenCalledTimes(1)
    a.unmount()
  })

  it('gives the key to the most recently mounted view first', () => {
    const order: string[] = []
    const a = mount(binder('esc', () => order.push('sheet')))
    const b = mount(binder('esc', () => order.push('view')))

    press('Escape', 27)

    // The view opened over the sheet is the one the user means.
    expect(order).toEqual(['view', 'sheet'])
    a.unmount()
    b.unmount()
  })

  it('stops listening once the last component goes', () => {
    const handler = vi.fn()
    const a = mount(binder('esc', handler))
    const b = mount(binder('esc', handler))

    a.unmount()
    b.unmount()
    press('Escape', 27)

    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps different keys independent', () => {
    const escape = vi.fn()
    const undo = vi.fn()
    const a = mount(binder('esc', escape))
    const b = mount(binder('mod+z', undo))

    b.unmount()
    press('Escape', 27)

    expect(escape).toHaveBeenCalledTimes(1)
    a.unmount()
  })
})
