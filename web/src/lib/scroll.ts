/**
 * Scroll-surface lookup for panel views.
 *
 * A view rendered inside a sheet doesn't own its scroll container — the host
 * sheet does (LeftSheet's Card on desktop, BottomSheet's container on mobile),
 * and both tag it with `data-sheet-scroll`. Views that need the scrolling
 * element itself — to save/restore a position, or to drive infinite scroll —
 * resolve it through here rather than assuming a particular ancestor.
 *
 * The walk up the tree is a fallback for hosts that don't carry the tag.
 */

export interface FindScrollAncestorOptions {
  /**
   * Also match `overflow-y: hidden` ancestors. Those still scroll
   * programmatically, so save/restore wants them; anything reacting to a
   * *user* scroll does not.
   */
  includeHidden?: boolean
}

export function findScrollAncestor(
  el: HTMLElement | null,
  { includeHidden = false }: FindScrollAncestorOptions = {},
): HTMLElement | null {
  if (!el) return null

  const tagged = el.closest('[data-sheet-scroll]') as HTMLElement | null
  if (tagged) return tagged

  let node = el.parentElement
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (
      overflowY === 'auto' ||
      overflowY === 'scroll' ||
      (includeHidden && overflowY === 'hidden')
    ) {
      return node
    }
    node = node.parentElement
  }
  return null
}
