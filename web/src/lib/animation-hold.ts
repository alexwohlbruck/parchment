/**
 * Defers work while a camera animation is in flight.
 *
 * Some map updates are destructive to an animation rather than merely
 * redundant during one — `setPadding` is a `jumpTo` underneath on both GL
 * engines, and `jumpTo` calls `stop()`, so applying it mid-flight leaves the
 * camera wherever the ease had got to. Wrapping such an update in a hold lets
 * the animation finish and applies the update once, when the camera is still.
 *
 * The work runs at most once per hold, and only if something was actually
 * deferred — an untouched hold ends silently.
 */
export function createAnimationHold(run: () => void): {
  readonly active: boolean
  begin: (duration: number, start?: () => void) => void
  defer: () => void
  end: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let owed = false
  let starting = false

  function end() {
    // Starting an animation over a running one makes the engine stop the old
    // one, which fires `moveend` synchronously. That event belongs to the
    // animation being replaced, not to a camera that has come to rest, so it
    // must not end the hold the new animation just took out — doing so would
    // apply the very update the hold exists to keep out of its way.
    if (starting) return
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!owed) return
    owed = false
    run()
  }

  return {
    get active() {
      return timer !== null
    },
    /**
     * Hold for up to `duration` ms, then start the animation via `start`.
     * A non-positive duration is not an animation to protect, so it holds
     * nothing — but `start` still runs.
     */
    begin(duration: number, start?: () => void) {
      if (duration > 0) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(end, duration)
      }
      if (!start) return
      starting = true
      try {
        start()
      } finally {
        starting = false
      }
    },
    defer() {
      owed = true
    },
    end,
  }
}
