/** Seconds a plant takes to grow in once it is placed, and to shrink away once it is gone. */
export const GROW_SECONDS = 0.45
/** Gathers a plant may be missing from, as while its tile is swapped for a finer one, and still be standing. */
const GRACE_GATHERS = 2
/** Seconds the same, for gathers that come in quick succession; a plant still in view lingers this long before it leaves. */
export const GRACE_SECONDS = 1.5
/** Gathers between sweeps of the plants long gone. */
const SWEEP_EVERY = 16

type Birth = { born: number; gather: number; seen: number; died?: number }

/** How far grown a plant is, 0-1, `t` seconds after its birth; mirrored by `growth` in the shader. */
export const grownAfter = (t: number) => 1 - (1 - Math.min(Math.max(t / GROW_SECONDS, 0), 1)) ** 3
/** How much of a plant is left, 0-1, `t` seconds after it started to leave; mirrored by `growth` in the shader. */
export const leftAfter = (t: number) => 1 - Math.min(Math.max(t / GROW_SECONDS, 0), 1) ** 2

/**
 * When each plant of one source first appeared, by where it stands, so one already standing keeps its
 * entrance from gather to gather and one that comes back after leaving the view grows in again.
 */
export class Births {
  private book = new Map<number, Birth>()
  private gather = 0
  private now = 0

  /** Start a gather at `now`, in seconds. */
  begin(now: number) {
    this.gather++
    this.now = now
    if (this.gather % SWEEP_EVERY === 0) for (const [key, birth] of this.book) if (this.gone(birth)) this.book.delete(key)
  }

  /**
   * When the plant at `key` was born: its own birth if it stood there lately, otherwise `fresh()`, and whether it
   * is new. One caught leaving grows back from as much of it as is left.
   */
  of(key: number, fresh: () => number): { born: number; isNew: boolean } {
    const known = this.book.get(key)
    if (known && !this.gone(known)) {
      known.gather = this.gather
      known.seen = this.now
      if (known.died !== undefined) {
        const left = leftAfter(this.now - known.died)
        known.died = undefined
        if (left > 1e-3) known.born = this.now - (1 - Math.cbrt(1 - left)) * GROW_SECONDS
        else known.born = fresh()
        return { born: known.born, isNew: true }
      }
      return { born: known.born, isNew: false }
    }
    const born = fresh()
    this.book.set(key, { born, gather: this.gather, seen: this.now })
    return { born, isNew: true }
  }

  /** The plant at `key` started to leave at `now`. */
  leave(key: number, now: number) {
    const known = this.book.get(key)
    if (known && known.died === undefined) known.died = now
  }

  /** Forget every plant, as when the zoom leaves the source's range and takes them all away. */
  clear() {
    this.book.clear()
  }

  private gone(birth: Birth) {
    return this.gather - birth.gather > GRACE_GATHERS + 1 && this.now - birth.seen > GRACE_SECONDS
  }
}
