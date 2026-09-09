import { describe, it, expect } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import Sidebar from './Sidebar.vue'
import SidebarRail from './SidebarRail.vue'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_ICON,
} from './scale'

/**
 * The rail is one control doing two jobs — drag to size, click to collapse —
 * so what separates them (a few pixels of pointer travel) is worth pinning.
 */
function mountRail(collapsed = false, width = SIDEBAR_WIDTH) {
  const state = { collapsed: ref(collapsed), width: ref(width) }
  const Harness = defineComponent({
    setup: () => () =>
      h(
        Sidebar,
        {
          collapsed: state.collapsed.value,
          'onUpdate:collapsed': (v: boolean) => (state.collapsed.value = v),
          width: state.width.value,
          'onUpdate:width': (v: number) => (state.width.value = v),
        },
        () => [h(SidebarRail, { label: 'Toggle navigation' })],
      ),
  })
  return { state, wrapper: mount(Harness) }
}

// Real pointer events arrive in separate task-queue turns, so Vue flushes
// between them. Ticking here matters: the panel only skips its collapse
// animation while a drag is actually in flight.
async function drag(wrapper: ReturnType<typeof mount>, from: number, to: number) {
  await wrapper.get('button').trigger('pointerdown', { button: 0, clientX: from })
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: to }))
  await nextTick()
  window.dispatchEvent(new MouseEvent('pointerup'))
  await nextTick()
}

describe('SidebarRail', () => {
  it('sizes the panel to the pointer, and stays there on release', async () => {
    const { state, wrapper } = mountRail()
    await drag(wrapper, 240, 300)
    expect(state.width.value).toBe(300)
    expect(state.collapsed.value).toBe(false)
    // Letting go must not hand the panel back to a stale animated width.
    expect(wrapper.get('nav').attributes('style')).toContain('width: 300px')
  })

  it('clamps to the resize bounds', async () => {
    const wide = mountRail()
    await drag(wide.wrapper, 240, 1000)
    expect(wide.state.width.value).toBe(SIDEBAR_MAX_WIDTH)

    const narrow = mountRail()
    await drag(narrow.wrapper, 240, SIDEBAR_MIN_WIDTH - 10)
    expect(narrow.state.width.value).toBe(SIDEBAR_MIN_WIDTH)
    expect(narrow.state.collapsed.value).toBe(false)
  })

  it('collapses when dragged well inside the minimum', async () => {
    const { state, wrapper } = mountRail()
    await drag(wrapper, 240, 100)
    expect(state.collapsed.value).toBe(true)
  })

  it('expands again when dragged back out from collapsed', async () => {
    const { state, wrapper } = mountRail(true, SIDEBAR_WIDTH)
    await drag(wrapper, SIDEBAR_WIDTH_ICON, SIDEBAR_WIDTH_ICON + 200)
    expect(state.collapsed.value).toBe(false)
    expect(state.width.value).toBe(SIDEBAR_WIDTH_ICON + 200)
  })

  it('toggles when the press does not move', async () => {
    const { state, wrapper } = mountRail()
    await drag(wrapper, 240, 240)
    expect(state.collapsed.value).toBe(true)
    expect(state.width.value).toBe(SIDEBAR_WIDTH)
  })

  it('does not toggle after a drag', async () => {
    const { state, wrapper } = mountRail()
    await drag(wrapper, 240, 320)
    expect(state.collapsed.value).toBe(false)
  })

  it('lands on the final width even when release shares the last frame', async () => {
    const { state, wrapper } = mountRail()
    await wrapper.get('button').trigger('pointerdown', { button: 0, clientX: 240 })
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    await nextTick()
    await nextTick()

    expect(state.width.value).toBe(300)
    expect(wrapper.get('nav').attributes('style')).toContain('width: 300px')
  })
})
