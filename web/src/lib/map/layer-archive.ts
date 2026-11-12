import type { Layer, LayerGroup } from '@/types/map.types'

export interface ArchivePartition {
  layers: Layer[]
  groups: LayerGroup[]
  /** What the user archived, outermost only: a group stands for its contents. */
  archived: (Layer | LayerGroup)[]
}

/** Splits off everything archived, including whatever sits inside an archived group. */
export function partitionArchived(
  layers: Layer[],
  groups: LayerGroup[],
): ArchivePartition {
  const byId = new Map(groups.map(g => [g.id, g]))
  const memo = new Map<string, boolean>()

  function groupArchived(id: string | null | undefined, seen = new Set<string>()): boolean {
    if (!id) return false
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    const group = byId.get(id)
    if (!group || seen.has(id)) return false
    seen.add(id)
    const result = !!group.archivedAt || groupArchived(group.parentGroupId, seen)
    memo.set(id, result)
    return result
  }

  const archived: (Layer | LayerGroup)[] = []
  const keptGroups = groups.filter(g => {
    if (!groupArchived(g.id)) return true
    if (g.archivedAt && !groupArchived(g.parentGroupId)) archived.push(g)
    return false
  })
  const keptLayers = layers.filter(l => {
    const inArchivedGroup = groupArchived(l.groupId)
    if (!l.archivedAt && !inArchivedGroup) return true
    if (!inArchivedGroup) archived.push(l)
    return false
  })

  return { layers: keptLayers, groups: keptGroups, archived }
}
