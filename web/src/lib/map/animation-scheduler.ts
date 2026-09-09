/**
 * Shared rAF scheduler for the marker-animation layers.
 *
 * Each layer that wants per-frame work registers a `Tick` here. The
 * scheduler runs ONE `requestAnimationFrame` loop and calls every
 * registered tick from it — instead of each layer scheduling its own
 * loop and the browser running them back-to-back. Two layers → one
 * rAF callback per frame instead of two.
 *
 * Each tick reports its own state:
 *
 *   - `'active'` — the tick made a visible change this frame; please
 *     keep ticking.
 *   - `'idle'` — the tick produced no change. After a short grace
 *     window (`SLEEP_AFTER_IDLE_TICKS` consecutive idle frames across
 *     ALL ticks), the scheduler stops the rAF loop entirely.
 *
 * To wake the scheduler back up — typically when a fresh sample
 * arrives and we want the marker to start moving again — call
 * `requestTick()`. It re-arms the loop and clears the idle counter.
 *
 * Why not just always tick: the layers spend most of their time idle
 * (no friends visible, all tracks past the staleness cap, user
 * stationary). Burning 60 callbacks/sec for nothing is a real battery
 * cost on phones / laptops on battery. Browsers throttle rAF on
 * hidden tabs but not on visible-but-idle ones.
 *
 * The grace window matters because the layers' "is anything moving?"
 * check is per-frame coarse — a brief stationary moment between two
 * fresh samples shouldn't tear down and re-arm the loop. Half a
 * second of slack is enough to ride out those gaps.
 */

export type Tick = (now: number) => 'active' | 'idle'

const ticks = new Set<Tick>()
let rafId: number | null = null
let consecutiveIdleFrames = 0
const SLEEP_AFTER_IDLE_FRAMES = 30 // ~500ms at 60fps

function loop(now: number): void {
  // Clear before we iterate so a tick can re-arm via requestTick()
  // mid-loop (e.g. a sample arriving inside its own tick callback)
  // without being immediately overwritten by our reset below.
  rafId = null

  let anyActive = false
  for (const tick of ticks) {
    try {
      if (tick(now) === 'active') anyActive = true
    } catch (err) {
      // Don't let one tick's failure blow up the whole loop. We log
      // and keep going so other layers stay animated.
      // eslint-disable-next-line no-console
      console.error('[animation-scheduler] tick threw:', err)
    }
  }

  if (anyActive) {
    consecutiveIdleFrames = 0
  } else {
    consecutiveIdleFrames++
  }

  if (consecutiveIdleFrames < SLEEP_AFTER_IDLE_FRAMES) {
    rafId = requestAnimationFrame(loop)
  }
  // else: the loop pauses. A future register() or requestTick() will
  // re-arm it.
}

/**
 * Register a per-frame tick. Returns an unregister function that
 * detaches the tick (and lets the loop sleep if no other ticks
 * remain). Calling `register` also wakes the scheduler — the new
 * tick gets called on the very next frame.
 */
export function register(tick: Tick): () => void {
  ticks.add(tick)
  requestTick()
  return () => {
    ticks.delete(tick)
  }
}

/**
 * Wake the scheduler. Call this when external state changes mean
 * registered ticks should produce work again — typically when a new
 * sample arrives. Idempotent and cheap.
 */
export function requestTick(): void {
  consecutiveIdleFrames = 0
  if (rafId == null) {
    rafId = requestAnimationFrame(loop)
  }
}

/** Testing hook. */
export function _resetForTests(): void {
  if (rafId != null) cancelAnimationFrame(rafId)
  rafId = null
  ticks.clear()
  consecutiveIdleFrames = 0
}
