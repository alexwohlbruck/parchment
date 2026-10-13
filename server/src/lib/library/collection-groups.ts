import type {
  CollectionOrganization,
  CollectionGroup,
} from '../../types/library.types'

export function groupPath(
  groups: CollectionGroup[],
  id: string | null,
): string {
  const names: string[] = []
  const visited = new Set<string>()
  while (id !== null && !visited.has(id)) {
    visited.add(id)
    const group = groups.find((group) => group.id === id)
    if (!group) break
    names.unshift(group.name)
    id = group.parentId
  }
  return names.join(' / ')
}

export function canParentGroup(
  groups: CollectionGroup[],
  id: string,
  parentId: string | null,
): boolean {
  const visited = new Set([id])
  while (parentId !== null) {
    if (visited.has(parentId)) return false
    visited.add(parentId)
    const parent = groups.find((group) => group.id === parentId)
    if (!parent) return false
    parentId = parent.parentId
  }
  return true
}

export function organizationError(
  organization: CollectionOrganization,
): string | null {
  const { groups, placements } = organization
  if (new Set(groups.map((group) => group.id)).size !== groups.length)
    return 'Group IDs must be unique'
  if (groups.some((group) => !group.id.trim() || !group.name.trim()))
    return 'Groups need an ID and a name'
  if (groups.some((group) => !canParentGroup(groups, group.id, group.parentId)))
    return 'Groups cannot contain themselves or have missing parents'
  const ids = new Set(groups.map((group) => group.id))
  if (placements.some((placement) => !ids.has(placement.groupId)))
    return 'Collection group does not exist'
  if (
    new Set(placements.map((placement) => placement.collectionId)).size !==
    placements.length
  )
    return 'A collection can only belong to one group'
  return null
}

export function removeGroup(
  organization: CollectionOrganization,
  id: string,
): CollectionOrganization {
  const group = organization.groups.find((group) => group.id === id)
  if (!group) return organization
  return {
    ...organization,
    groups: organization.groups
      .filter((group) => group.id !== id)
      .map((child) =>
        child.parentId === id ? { ...child, parentId: group.parentId } : child,
      ),
    placements: organization.placements.flatMap((placement) => {
      if (placement.groupId !== id) return [placement]
      return group.parentId === null
        ? []
        : [{ ...placement, groupId: group.parentId }]
    }),
  }
}
