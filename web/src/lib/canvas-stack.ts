/**
 * The one stack a canvas is arranged in.
 *
 * Layers and marks used to be two lists, with marks pinned above every layer.
 * That was a rule you had to be told rather than one you could see, and it
 * made the panel two things to learn. They are peers now: one list, bottom
 * first, where what covers what is exactly what the list says.
 *
 * The body keeps its `layers` and `annotations` buckets — they are what the
 * API stores and what everything else reads — and `order` interleaves them by
 * id. A canvas saved before the merge has no `order` at all, and reads as
 * every layer then every mark, which is the order it used to draw in.
 */

import type {
  CanvasAnnotation,
  CanvasBody,
  CanvasGroup,
  CanvasLayer,
} from '@/types/canvas.types'

export interface StackLayer {
  kind: 'layer'
  id: string
  layer: CanvasLayer
}

export interface StackAnnotation {
  kind: 'annotation'
  id: string
  annotation: CanvasAnnotation
}

/** Something that actually draws. A group only holds these. */
export type StackItem = StackLayer | StackAnnotation

export interface StackGroup {
  kind: 'group'
  id: string
  group: CanvasGroup
  children: StackItem[]
}

export type StackEntry = StackItem | StackGroup

/** Bottom of the list draws first, so this reads bottom first throughout. */
export function canvasStack(body: CanvasBody): StackEntry[] {
  const layers = new Map((body.layers ?? []).map(l => [l.id, l]))
  const annotations = new Map((body.annotations ?? []).map(a => [a.id, a]))
  const groups = new Map((body.groups ?? []).map(g => [g.id, g]))

  /** Claimed as we go, so nothing can be placed twice. */
  const placed = new Set<string>()

  function item(id: string): StackItem | null {
    if (placed.has(id)) return null
    const layer = layers.get(id)
    if (layer) {
      placed.add(id)
      return { kind: 'layer', id, layer }
    }
    const annotation = annotations.get(id)
    if (annotation) {
      placed.add(id)
      return { kind: 'annotation', id, annotation }
    }
    return null
  }

  function group(id: string): StackGroup | null {
    const group = groups.get(id)
    if (!group || placed.has(id)) return null
    placed.add(id)
    return {
      kind: 'group',
      id,
      group,
      children: (group.children ?? [])
        .map(item)
        .filter((child): child is StackItem => child !== null),
    }
  }

  const entries: StackEntry[] = []
  for (const id of body.order ?? []) {
    const entry = group(id) ?? item(id)
    if (entry) entries.push(entry)
  }

  // Anything the order doesn't mention: a canvas from before the merge, or
  // something added by a client that didn't know to file it. Layers then
  // marks, which is where they used to draw.
  for (const layer of body.layers ?? []) {
    const entry = item(layer.id)
    if (entry) entries.push(entry)
  }
  for (const annotation of body.annotations ?? []) {
    const entry = item(annotation.id)
    if (entry) entries.push(entry)
  }
  for (const group of body.groups ?? []) {
    if (!placed.has(group.id)) {
      placed.add(group.id)
      entries.push({
        kind: 'group',
        id: group.id,
        group,
        children: (group.children ?? [])
          .map(item)
          .filter((child): child is StackItem => child !== null),
      })
    }
  }

  return entries
}

/**
 * Everything that draws, in draw order, with whether it is actually showing —
 * a group switched off takes its contents with it however each one is set.
 */
export function stackDrawOrder(
  entries: StackEntry[],
): { item: StackItem; visible: boolean }[] {
  const drawn: { item: StackItem; visible: boolean }[] = []
  for (const entry of entries) {
    if (entry.kind === 'group') {
      for (const child of entry.children) {
        drawn.push({ item: child, visible: entry.group.visible && shown(child) })
      }
      continue
    }
    drawn.push({ item: entry, visible: shown(entry) })
  }
  return drawn
}

/** A mark has no switch of its own; a layer does. */
function shown(item: StackItem) {
  return item.kind === 'layer' ? item.layer.visible : true
}

/**
 * What Sortable reports when something is dropped. `added` and `moved` both
 * say where the item landed; `removed` is the other half of a move between
 * two lists and is deliberately not acted on.
 */
export interface StackChange {
  added?: { element: StackEntry; newIndex: number }
  moved?: { element: StackEntry; newIndex: number }
  removed?: unknown
}

/**
 * One item moved to one place: the whole of what a drag does.
 *
 * Sortable reports a move between two lists as two events, one per list, and
 * rebuilding the stack from each half in turn was the source of every bug
 * here — the item was briefly filed nowhere, the intermediate write
 * re-rendered the list mid-drag, and the second half landed against a stack
 * that had already moved under it. So the drag handlers ignore the half that
 * says "this left" and act only on the half that says "this arrived", which
 * carries everything needed: what moved, where to, and at what index.
 *
 * Nothing is added or dropped here, only repositioned — a rearrangement can
 * never lose a layer. Removal goes through `removeFromStack`.
 */
export function moveInStack(
  body: CanvasBody,
  id: string,
  to: { groupId: string | null; index: number },
): CanvasBody {
  const order = canvasStack(body)
    .map(entry => entry.id)
    .filter(entryId => entryId !== id)
  const groups = (body.groups ?? []).map(group => ({
    ...group,
    children: (group.children ?? []).filter(child => child !== id),
  }))

  const into = (list: string[], index: number) => {
    list.splice(Math.max(0, Math.min(index, list.length)), 0, id)
    return list
  }

  if (to.groupId === null) return { ...body, order: into(order, to.index), groups }

  const group = groups.find(group => group.id === to.groupId)
  // A group that has gone away mid-drag: leave the item where it can be seen
  // rather than filing it somewhere nothing will render.
  if (!group) return { ...body, order: into(order, order.length), groups }
  group.children = into(group.children, to.index)
  return { ...body, order, groups }
}

/** Adding something new puts it on top, which is where you expect to find it. */
export function appendToStack(body: CanvasBody, id: string): string[] {
  const order = canvasStack(body).map(entry => entry.id)
  return order.includes(id) ? order : [...order, id]
}

/**
 * Dropping something out of the stack, wherever it sits — a group has to let
 * go of a child it holds, or the child comes back the next time the stack is
 * read from the buckets.
 */
export function removeFromStack(body: CanvasBody, id: string): CanvasBody {
  return {
    ...body,
    order: (body.order ?? []).filter(entryId => entryId !== id),
    groups: (body.groups ?? []).map(group =>
      group.children?.includes(id)
        ? { ...group, children: group.children.filter(child => child !== id) }
        : group,
    ),
  }
}

/** A group and everything filed in it, for when the group itself is deleted. */
export function groupContents(body: CanvasBody, groupId: string): string[] {
  return (body.groups ?? []).find(group => group.id === groupId)?.children ?? []
}
