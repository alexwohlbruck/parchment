import { toValue, type MaybeRefOrGetter } from 'vue'
import { useEventListener } from '@vueuse/core'

const TAP_SLOP_PX = 10

/**
 * Focus an input only on a tap, so a drag that starts on it moves the host
 * sheet instead of opening the keyboard. Once focused it behaves normally.
 */
export function useTapToFocus(
  target: MaybeRefOrGetter<HTMLElement | null | undefined>,
) {
  let start: { x: number; y: number } | null = null
  const isFocused = () => document.activeElement === toValue(target)

  useEventListener(target, 'pointerdown', (event: PointerEvent) => {
    if (isFocused() || event.button !== 0) return
    // Mouse focuses on pointerdown; touch focuses on the tap that touchstart's
    // default would produce.
    event.preventDefault()
    start = { x: event.clientX, y: event.clientY }
  })

  useEventListener(
    target,
    'touchstart',
    (event: TouchEvent) => {
      if (!isFocused()) event.preventDefault()
    },
    { passive: false },
  )

  useEventListener(target, 'pointerup', (event: PointerEvent) => {
    if (!start) return
    const moved =
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX
    start = null
    if (!moved) toValue(target)?.focus()
  })

  useEventListener(target, 'pointercancel', () => {
    start = null
  })
}
