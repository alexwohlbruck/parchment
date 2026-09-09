import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { useStuck } from './useStuck'

/**
 * The docked line is `scrollRoot.top + the element's own CSS top`, so these
 * tests drive the two rects directly rather than trying to make jsdom lay a
 * real sticky element out — jsdom has no sticky positioning at all.
 */
function rect(top: number) {
  return () => ({ top }) as DOMRect
}

const Host = defineComponent({
  setup() {
    const { stuckRef, stuck } = useStuck()
    return { stuckRef, stuck }
  },
  render() {
    return h('div', { 'data-sheet-scroll': '', style: 'overflow-y: auto' }, [
      h('div', { ref: 'stuckRef', style: 'position: sticky; top: 44px' }),
    ])
  },
})

let wrapper: ReturnType<typeof mount> | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

async function mountAt(rootTop: number, elTop: number, scrollTop = 120) {
  wrapper = mount(Host, { attachTo: document.body })
  const root = wrapper.element as HTMLElement
  const el = root.firstElementChild as HTMLElement
  root.getBoundingClientRect = rect(rootTop)
  el.getBoundingClientRect = rect(elTop)
  // jsdom lays nothing out, so scrollTop never moves on its own.
  Object.defineProperty(root, 'scrollTop', { value: scrollTop, writable: true })
  root.dispatchEvent(new Event('scroll'))
  await new Promise(r => requestAnimationFrame(() => r(null)))
  await nextTick()
  return wrapper
}

describe('useStuck', () => {
  it('is not stuck while the header still sits below its docked line', async () => {
    // root at 100, docks at 100 + 44 = 144; the header is still at 200.
    const w = await mountAt(100, 200)
    expect((w.vm as unknown as { stuck: boolean }).stuck).toBe(false)
  })

  it('is stuck once the header can rise no higher than its docked line', async () => {
    const w = await mountAt(100, 144)
    expect((w.vm as unknown as { stuck: boolean }).stuck).toBe(true)
  })

  // Scrolling alone must not count as stuck: the whole point of measuring
  // against the dock line is that a header 1px into a scroll is still inline.
  it('stays unstuck for a scroll that has not reached the dock line', async () => {
    const w = await mountAt(100, 145)
    expect((w.vm as unknown as { stuck: boolean }).stuck).toBe(false)
  })

  // A header whose resting position already IS its dock line sits pinned from
  // the moment it mounts. Reporting that as stuck leaves a scroll-triggered
  // border showing over untouched content.
  it('is not stuck while docked at rest, before anything has scrolled', async () => {
    const w = await mountAt(100, 144, 0)
    expect((w.vm as unknown as { stuck: boolean }).stuck).toBe(false)
  })
})
