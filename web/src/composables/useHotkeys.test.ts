import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

/** Press a key from inside a text field, the way a focused input sees it. */
function pressIn(
  element: Element,
  key: string,
  keyCode: number,
  modifiers: Partial<KeyboardEvent> = {},
) {
  element.dispatchEvent(
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

/**
 * Mousetrap resolves `mod` to meta or ctrl by platform, and an event whose
 * modifiers don't match the binding exactly never matches at all.
 */
const MOD = /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  ? 'metaKey'
  : 'ctrlKey'

function modZ(element: Element) {
  pressIn(element, 'z', 90, { [MOD]: true } as Partial<KeyboardEvent>)
}

function field(value = '') {
  const input = document.createElement('input')
  input.value = value
  document.body.appendChild(input)
  return input
}

afterEach(() => {
  document.body.innerHTML = ''
})

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


/**
 * Mousetrap drops every key pressed inside a text field. That is right for a
 * single-letter shortcut and wrong for a view-level ⌘Z: the canvas editor
 * opens a new mark's name field for you, and undo went dead the moment it
 * did — while the toolbar button next to it still worked.
 */
describe('keys pressed inside a text field', () => {
  function undoBinder(handler: () => void, allowInInput?: boolean | ((el: Element) => boolean)) {
    return defineComponent({
      setup() {
        useHotkeys([{ key: 'mod+z', handler, allowInInput, preventDefault: false }])
        return () => null
      },
    })
  }

  it('are dropped, as they always were', () => {
    const handler = vi.fn()
    const wrapper = mount(undoBinder(handler))

    modZ(field())

    expect(handler).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('reach a binding that asked for them', () => {
    const handler = vi.fn()
    const wrapper = mount(undoBinder(handler, true))

    modZ(field())

    expect(handler).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('let a predicate hand the key to the field or the view', () => {
    const handler = vi.fn()
    const wrapper = mount(
      undoBinder(handler, el => !(el as HTMLInputElement).value),
    )

    // Nothing typed: no text to take back, so the view gets it.
    modZ(field())
    expect(handler).toHaveBeenCalledTimes(1)

    // Something typed: the field keeps its own undo.
    modZ(field('Water station'))
    expect(handler).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('go back to being dropped once the binding is gone', () => {
    const handler = vi.fn()
    mount(undoBinder(handler, true)).unmount()

    modZ(field())

    expect(handler).not.toHaveBeenCalled()
  })
})
