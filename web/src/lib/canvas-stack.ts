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
 *
 * Groups nest: a group's `children` may name another group, so a stack is a
 * tree and only its leaves draw. Nothing below reads `groups` as a flat list
 * — walk from `order` down, and use `placed` to make sure a malformed
 * document (a group that holds itself, however it got that way) terminates.
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

/** Something that actually draws. */
export type StackItem = StackLayer | StackAnnotation

export interface StackGroup {
  kind: 'group'
  id: string
  group: CanvasGroup
  /** Layers, marks and groups alike — a folder can hold a folder. */
  children: StackEntry[]
}

export type StackEntry = StackItem | StackGroup

/** Bottom of the list draws first, so this reads bottom first throughout. */
export function canvasStack(body: CanvasBody): StackEntry[] {
  const layers = new Map((body.layers ?? []).map(l => [l.id, l]))
  const annotations = new Map((body.annotations ?? []).map(a => [a.id, a]))
  const groups = new Map((body.groups ?? []).map(g => [g.id, g]))

  /** Claimed as we go, so nothing can be placed twice. */
  const placed = new Set<string>()

  /** Who holds what, for deciding which groups are loose in the stack. */
  const parentOf = new Map<string, string>()
  for (const group of body.groups ?? []) {
    for (const child of group.children ?? []) {
      if (!parentOf.has(child)) parentOf.set(child, group.id)
    }
  }

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
    // Claimed before its children are read: a group that ends up inside
    // itself resolves to null the second time round rather than recursing.
    placed.add(id)
    return { kind: 'group', id, group, children: entries(group.children ?? []) }
  }

  function entry(id: string): StackEntry | null {
    return group(id) ?? item(id)
  }

  function entries(ids: string[]): StackEntry[] {
    return ids
      .map(entry)
      .filter((child): child is StackEntry => child !== null)
  }

  const stack = entries(body.order ?? [])

  // Anything the order doesn't mention: a canvas from before the merge, or
  // something added by a client that didn't know to file it.

  // Groups first, and only the ones nobody holds — a nested group is brought
  // in by its parent, and hoisting it here would empty the parent out. A
  // group whose holder has been deleted counts as loose.
  for (const candidate of body.groups ?? []) {
    const parent = parentOf.get(candidate.id)
    if (parent !== undefined && groups.has(parent)) continue
    const entry = group(candidate.id)
    if (entry) stack.push(entry)
  }
  // Whatever is left can only be a cycle, which has no outermost group to
  // start from. Better shown at the top level than not at all.
  for (const candidate of body.groups ?? []) {
    const entry = group(candidate.id)
    if (entry) stack.push(entry)
  }

  // Then the loose layers and marks, in the order they used to draw in.
  for (const layer of body.layers ?? []) {
    const entry = item(layer.id)
    if (entry) stack.push(entry)
  }
  for (const annotation of body.annotations ?? []) {
    const entry = item(annotation.id)
    if (entry) stack.push(entry)
  }

  return stack
}

/**
 * Everything that draws, in draw order, with whether it is actually showing —
 * a group switched off takes its contents with it however each one is set,
 * and so does a group above that one.
 */
export function stackDrawOrder(
  entries: StackEntry[],
  inherited = true,
): { item: StackItem; visible: boolean }[] {
  const drawn: { item: StackItem; visible: boolean }[] = []
  for (const entry of entries) {
    if (entry.kind === 'group') {
      drawn.push(
        ...stackDrawOrder(entry.children, inherited && entry.group.visible),
      )
      continue
    }
    drawn.push({ item: entry, visible: inherited && shown(entry) })
  }
  return drawn
}

/** A mark has no switch of its own; a layer does. */
function shown(item: StackItem) {
  return item.kind === 'layer' ? item.layer.visible : true
}

/**
 * Every group in the stack, flattened, with how deep it sits — for the
 * destination picker, where a nested group has to read as nested.
 */
export function groupOptions(
  entries: StackEntry[],
  depth = 0,
): { id: string; name: string; depth: number }[] {
  return entries.flatMap(entry =>
    entry.kind === 'group'
      ? [
          { id: entry.id, name: entry.group.name, depth },
          ...groupOptions(entry.children, depth + 1),
        ]
      : [],
  )
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

/** The groups inside this one, at every depth. */
function descendantGroups(body: CanvasBody, id: string): Set<string> {
  const groups = new Map((body.groups ?? []).map(g => [g.id, g]))
  const found = new Set<string>()
  const walk = (groupId: string) => {
    for (const child of groups.get(groupId)?.children ?? []) {
      if (!groups.has(child) || found.has(child)) continue
      found.add(child)
      walk(child)
    }
  }
  walk(id)
  return found
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
  // A group cannot be filed inside itself or inside anything it holds: the
  // branch would leave the tree with it. Sortable won't normally offer the
  // drop, but the model has to be the one that guarantees it.
  if (
    to.groupId !== null &&
    (to.groupId === id || descendantGroups(body, id).has(to.groupId))
  ) {
    return body
  }

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
 * Files something new on top of the stack, or on top of a group's contents
 * when one is the current destination — what the pin and drawing tools do
 * with every mark while a group is selected.
 */
export function addToStack(
  body: CanvasBody,
  id: string,
  groupId: string | null = null,
): CanvasBody {
  const group = (body.groups ?? []).find(group => group.id === groupId)
  // A destination that has since been deleted falls back to the top level,
  // rather than losing the thing that was just made.
  if (!group) return { ...body, order: appendToStack(body, id) }

  return {
    ...body,
    groups: (body.groups ?? []).map(candidate =>
      candidate.id === group.id
        ? { ...candidate, children: [...(candidate.children ?? []), id] }
        : candidate,
    ),
  }
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

/**
 * The group holding something — a layer, a mark or another group — or null
 * when it sits at the top level.
 *
 * This is what makes the selection say where new work goes: pick anything
 * inside a folder and the folder is where the next mark is filed.
 */
export function parentGroupId(body: CanvasBody, id: string): string | null {
  return (
    (body.groups ?? []).find(group => group.children?.includes(id))?.id ?? null
  )
}

/**
 * Ungrouping: the folder goes, what was in it stays.
 *
 * A folder is how the stack is tidied, not something the layers inside belong
 * to — so its contents come back out exactly where it was, in the order they
 * were in it, whether it sat at the top level or inside another group.
 */
export function dissolveGroup(body: CanvasBody, id: string): CanvasBody {
  const contents = groupContents(body, id)
  const splice = (list: string[]) =>
    list.flatMap(entryId => (entryId === id ? contents : [entryId]))

  return {
    ...body,
    // A body with no order of its own gets one here rather than losing the
    // position the group held.
    order: splice(body.order ?? canvasStack(body).map(entry => entry.id)),
    groups: (body.groups ?? [])
      .filter(group => group.id !== id)
      .map(group => ({ ...group, children: splice(group.children ?? []) })),
  }
}
