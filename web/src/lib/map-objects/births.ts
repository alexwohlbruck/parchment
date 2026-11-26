/** Gathers a plant may be missing from, as while its tile is swapped for a finer one, and still be standing. */
const GRACE_GATHERS = 2
/** Seconds the same, for gathers that come in quick succession. */
const GRACE_SECONDS = 1.5
/** Gathers between sweeps of the plants long gone. */
const SWEEP_EVERY = 16

type Birth = { born: number; gather: number; seen: number }

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

  /** When the plant at `key` was born: its own birth if it stood there lately, otherwise `fresh()`, and whether it is new. */
  of(key: number, fresh: () => number): { born: number; isNew: boolean } {
    const known = this.book.get(key)
    if (known && !this.gone(known)) {
      known.gather = this.gather
      known.seen = this.now
      return { born: known.born, isNew: false }
    }
    const born = fresh()
    this.book.set(key, { born, gather: this.gather, seen: this.now })
    return { born, isNew: true }
  }

  /** Forget every plant, as when the zoom leaves the source's range and takes them all away. */
  clear() {
    this.book.clear()
  }

  private gone(birth: Birth) {
    return this.gather - birth.gather > GRACE_GATHERS + 1 && this.now - birth.seen > GRACE_SECONDS
  }
}
