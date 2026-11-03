export interface HeldPointers {
  readonly count: number
  dispose(): void
}

/** Counts pointers pressed inside `within()` and not yet released; `onRelease` runs when the last lifts. */
export function trackHeldPointers(within: () => Element | null | undefined, onRelease?: () => void): HeldPointers {
  const held = new Set<number>()
  const press = (event: PointerEvent) => {
    if (event.target instanceof Node && within()?.contains(event.target)) held.add(event.pointerId)
  }
  const release = (event: PointerEvent) => {
    if (held.delete(event.pointerId) && held.size === 0) onRelease?.()
  }
  window.addEventListener('pointerdown', press, true)
  window.addEventListener('pointerup', release, true)
  window.addEventListener('pointercancel', release, true)
  return {
    get count() {
      return held.size
    },
    dispose() {
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
    },
  }
}
