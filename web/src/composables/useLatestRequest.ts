/**
 * One request at a time, where asking again replaces the ask before it.
 *
 * The canvas asks the routing engine for a path while its waypoints are
 * still being placed, and the isochrone engine for a shape while the reach
 * is still being dragged — so the answer that matters is always the last one
 * asked for, and everything before it is so much wasted network. Each of
 * those places used to keep its own AbortController, its own "is one in
 * flight" flag and its own idea of which errors were worth a console line;
 * there were four copies of it across the drawing tools.
 *
 * A superseded call resolves to `SUPERSEDED` rather than to nothing, because
 * the two mean opposite things to a caller: a request that failed leaves the
 * mark with no answer, while one that was replaced has a better answer
 * already on its way and must leave everything exactly as it is.
 */

import { onScopeDispose, ref } from 'vue'

/** What a call resolves to when a newer one took its place. */
export const SUPERSEDED = Symbol('superseded')

/** Cancelled, rather than failed — including our own `RouteSnapAborted`. */
function isAbort(error: unknown): boolean {
  return !!(error as Error | undefined)?.name?.includes('Abort')
}

export function useLatestRequest(label: string) {
  /**
   * Follows the newest request only: a superseded one clearing this would
   * say the engine had finished while its answer was still on the way.
   */
  const pending = ref(false)
  let controller: AbortController | undefined

  async function run<T>(
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T | undefined | typeof SUPERSEDED> {
    controller?.abort()
    const mine = new AbortController()
    controller = mine
    pending.value = true
    try {
      return await task(mine.signal)
    } catch (error) {
      if (isAbort(error)) return SUPERSEDED
      console.error(`[canvas] ${label}`, error)
      return undefined
    } finally {
      if (controller === mine) {
        pending.value = false
        controller = undefined
      }
    }
  }

  function abort() {
    controller?.abort()
    controller = undefined
    pending.value = false
  }

  onScopeDispose(abort)

  return { pending, run, abort }
}
