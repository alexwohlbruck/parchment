export interface GroupNode<T> {
  value: T
  children: GroupNode<T>[]
}

export function ancestorIds(
  parents: ReadonlyMap<string, string | null>,
  id: string | null,
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  while (id !== null && parents.has(id) && !seen.has(id)) {
    seen.add(id)
    result.push(id)
    id = parents.get(id) ?? null
  }
  return result
}

export function canMoveGroup(
  parents: ReadonlyMap<string, string | null>,
  id: string,
  parentId: string | null,
): boolean {
  if (!parents.has(id)) return false
  if (parentId === null) return true
  const ancestors = ancestorIds(parents, parentId)
  const root = ancestors[ancestors.length - 1]
  return (
    root !== undefined && parents.get(root) === null && !ancestors.includes(id)
  )
}

export function descendantIds(
  children: ReadonlyMap<string, readonly string[]>,
  id: string,
): Set<string> {
  const found = new Set<string>()
  const pending = [id]
  while (pending.length) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (!children.has(child) || found.has(child)) continue
      found.add(child)
      pending.push(child)
    }
  }
  return found
}

export function buildGroupHierarchy<T extends { id: string }>(
  groups: T[],
  parentId: (group: T) => string | null | undefined,
): GroupNode<T>[] {
  const ids = new Set(groups.map(group => group.id))
  const children = new Map<string | null, T[]>()
  for (const group of groups) {
    const parent = parentId(group)
    const key = parent && ids.has(parent) ? parent : null
    const siblings = children.get(key) ?? []
    siblings.push(group)
    children.set(key, siblings)
  }
  const placed = new Set<string>()
  function node(group: T): GroupNode<T> | null {
    if (placed.has(group.id)) return null
    placed.add(group.id)
    return {
      value: group,
      children: (children.get(group.id) ?? []).flatMap(child => {
        const nested = node(child)
        return nested ? [nested] : []
      }),
    }
  }
  const roots = (children.get(null) ?? []).flatMap(group => {
    const root = node(group)
    return root ? [root] : []
  })
  for (const group of groups) {
    const root = node(group)
    if (root) roots.push(root)
  }
  return roots
}

export function groupItemCounts(
  parents: ReadonlyMap<string, string | null>,
  direct: ReadonlyMap<string, number>,
): Map<string, number> {
  const children = new Map<string, string[]>()
  for (const [id, parent] of parents) {
    if (parent === null) continue
    const siblings = children.get(parent) ?? []
    siblings.push(id)
    children.set(parent, siblings)
  }
  const totals = new Map<string, number>()
  const active = new Set<string>()
  function total(id: string): number {
    const cached = totals.get(id)
    if (cached !== undefined) return cached
    if (active.has(id)) return 0
    active.add(id)
    let sum = direct.get(id) ?? 0
    for (const child of children.get(id) ?? []) sum += total(child)
    active.delete(id)
    totals.set(id, sum)
    return sum
  }
  for (const id of parents.keys()) total(id)
  return totals
}
