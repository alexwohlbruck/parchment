/**
 * Chrome mobile workaround for vaul-vue drawers.
 * Issue documented here:
 * https://github.com/unovue/shadcn-vue/issues/775
 *
 * Chrome mobile drops the first click event after a fast drag gesture on vaul drawers.
 * This workaround detects when a drag ends and simulates a click on the pointerup target
 * if Chrome fails to fire the native click event.
 *
 * We only simulate a click if the pointer didn't move significantly (i.e., it was a tap,
 * not a swipe gesture).
 */

type VaulWindow = {
  __vaulDragReleased?: boolean
  __vaulPointerStart?: { x: number; y: number; target: EventTarget | null }
} & Window

// Maximum distance (in pixels) the pointer can move to still be considered a tap
const TAP_THRESHOLD = 10

/**
 * Call this from the @release event of DrawerRoot.
 * Marks that a drag gesture just ended.
 */
export function handleVaulRelease() {
  ;(window as VaulWindow).__vaulDragReleased = true
}

/**
 * Initialize the Chrome mobile workaround.
 * Call this once at app startup (e.g., in main.ts).
 */
export function initVaulChromeWorkaround() {
  const win = window as VaulWindow
  win.__vaulDragReleased = false

  let pendingTarget: HTMLElement | null = null

  // Not related to workaround, prevents native context menu from opening on vaul overlays
  document.addEventListener('contextmenu', event => {
    if (
      event.target instanceof HTMLElement &&
      event.target.hasAttribute('data-vaul-overlay')
    ) {
      event.preventDefault()
    }
  })

  // Track pointer start position to detect swipes vs taps
  document.addEventListener(
    'pointerdown',
    event => {
      win.__vaulPointerStart = {
        x: event.clientX,
        y: event.clientY,
        target: event.target,
      }
    },
    true,
  )

  document.addEventListener(
    'pointerup',
    event => {
      if (!win.__vaulDragReleased) {
        return
      }
      win.__vaulDragReleased = false

      // Check if this was a swipe (significant movement) vs a tap
      const start = win.__vaulPointerStart
      if (start) {
        const dx = Math.abs(event.clientX - start.x)
        const dy = Math.abs(event.clientY - start.y)
        const distance = Math.sqrt(dx * dx + dy * dy)

        // If the pointer moved significantly, it's a swipe - don't simulate click
        if (distance > TAP_THRESHOLD) {
          win.__vaulPointerStart = undefined
          return
        }

        // Also check if the target changed (finger landed on different element)
        if (event.target !== start.target) {
          win.__vaulPointerStart = undefined
          return
        }
      }

      win.__vaulPointerStart = undefined
      pendingTarget = event.target as HTMLElement | null

      // Dispatch an artificial click event after a short delay
      // This gives Chrome a chance to fire the native click first
      window.setTimeout(() => {
        if (pendingTarget) {
          pendingTarget.dispatchEvent(
            new MouseEvent('click', { bubbles: true }),
          )
          pendingTarget = null
        }
      }, 1)
    },
    true,
  )

  // On click event, clear the pending target (native click fired successfully)
  document.addEventListener(
    'click',
    () => {
      pendingTarget = null
    },
    true,
  )
}
