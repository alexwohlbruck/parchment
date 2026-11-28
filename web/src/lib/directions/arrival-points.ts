import { arrivalCategories } from '@server/lib/place/arrival-points'
import type { AutocompleteResult } from '@/types/search.types'

/** Rows a place's arrival points take before the rest fold behind "N more". */
const SHOWN_BEFORE_MORE = 3

/** Whether a search result holds precise destinations worth listing under it in this mode. */
export function offersArrivalPoints(result: AutocompleteResult, mode: string): boolean {
  return !!result.arrivalPresetId && arrivalCategories(result.arrivalPresetId, mode).length > 0
}

/** The arrival points to list under their place, and how many are folded away. */
export function visibleArrivalPoints<T>(points: T[], expanded: boolean): { shown: T[]; hidden: number } {
  // Folding a single row away saves nothing: the "more" row would take its place.
  if (expanded || points.length <= SHOWN_BEFORE_MORE + 1) return { shown: points, hidden: 0 }
  return {
    shown: points.slice(0, SHOWN_BEFORE_MORE),
    hidden: points.length - SHOWN_BEFORE_MORE,
  }
}
