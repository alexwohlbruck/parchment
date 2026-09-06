import { getCurrentScope, onScopeDispose, readonly, ref } from 'vue'

/**
 * How much of the screen the on-screen keyboard is currently covering.
 *
 * There's no portable keyboard API, so this reads the gap the keyboard opens up
 * between the layout viewport and the visual viewport. When a browser shrinks
 * the layout viewport instead — Android's `resizes-content` behaviour — that
 * gap is zero, which is the right answer there: the page has already been laid
 * out around the keyboard and needs no padding of its own.
 *
 * The value is published as `--keyboard-inset-height` on the document element,
 * so layout can react in CSS alone, and is `0px` whenever no keyboard is up.
 * Call it once high in the tree (App); the listeners are shared.
 */

const height = ref(0)
let subscribers = 0

function measure() {
  const viewport = window.visualViewport
  const next = viewport
    ? Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      )
    : 0
  if (next === height.value) return
  height.value = next
  document.documentElement.style.setProperty(
    '--keyboard-inset-height',
    `${next}px`,
  )
}

function attach() {
  // Publish the resting value up front, so the property always resolves rather
  // than leaning on every `var()` call site carrying a fallback.
  document.documentElement.style.setProperty('--keyboard-inset-height', '0px')
  // The visual viewport also *scrolls* under a keyboard (iOS pans the page to
  // keep the focused field visible), so both events matter.
  window.visualViewport?.addEventListener('resize', measure)
  window.visualViewport?.addEventListener('scroll', measure)
  window.addEventListener('resize', measure)
  measure()
}

function detach() {
  window.visualViewport?.removeEventListener('resize', measure)
  window.visualViewport?.removeEventListener('scroll', measure)
  window.removeEventListener('resize', measure)
  height.value = 0
  document.documentElement.style.setProperty('--keyboard-inset-height', '0px')
}

export function useVirtualKeyboard() {
  if (typeof window !== 'undefined') {
    if (subscribers === 0) attach()
    subscribers += 1

    if (getCurrentScope()) {
      onScopeDispose(() => {
        subscribers -= 1
        if (subscribers === 0) detach()
      })
    }
  }

  return { keyboardHeight: readonly(height) }
}
