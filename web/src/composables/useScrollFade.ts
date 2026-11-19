import { computed, type Ref } from 'vue'
import { useResizeObserver, useScroll } from '@vueuse/core'

/**
 * A mask that fades whichever edge of a scroller still has content past it,
 * so a list that is cut off reads as scrollable. Bind the result to `style`.
 */
export function useScrollFade(el: Ref<HTMLElement | null>, fade = '24px') {
  const { arrivedState, measure } = useScroll(el)
  useResizeObserver(el, () => measure())

  return computed(() => {
    const top = arrivedState.top ? '0px' : fade
    const bottom = arrivedState.bottom ? '0px' : fade
    if (arrivedState.top && arrivedState.bottom) return undefined
    const mask = `linear-gradient(to bottom, transparent, #000 ${top}, #000 calc(100% - ${bottom}), transparent)`
    return { maskImage: mask, WebkitMaskImage: mask }
  })
}
