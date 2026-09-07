/**
 * Defers work while a camera animation is in flight.
 *
 * Some map updates are destructive to an animation rather than merely
 * redundant during one — `setPadding` is a `jumpTo` underneath on both GL
 * engines, and `jumpTo` calls `stop()`, so applying it mid-flight leaves the
 * camera wherever the ease had got to. Wrapping such an update in a hold lets
 * the animation finish and applies the update once, when the camera is still.
 *
 * The hold is TIME-based: it runs for the animation's declared duration and
 * ends on its own. It deliberately does not listen for the engine's "camera
 * at rest" events — MapLibre emits a spontaneous `moveend` mid-ease when the
 * globe render path flattens at its zoom threshold, and a hold released on
 * that event applies the deferred update into the animation it was
 * protecting, killing it at exactly that zoom. Waiting out the clock costs
 * at most the tail of an already-declared duration.
 *
 * The work runs at most once per hold, and only if something was actually
 * deferred — an untouched hold ends silently.
 */
export function createAnimationHold(run: () => void): {
  readonly active: boolean
  begin: (duration: number) => void
  defer: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let owed = false

  function end() {
    timer = null
    if (!owed) return
    owed = false
    run()
  }

  return {
    get active() {
      return timer !== null
    },
    /** A non-positive duration is not an animation to protect. */
    begin(duration: number) {
      if (!(duration > 0)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(end, duration)
    },
    defer() {
      owed = true
    },
  }
}
