import type {
  CollectionOrganization,
  CollectionGroup,
} from '../../types/library.types'

import { ancestorIds, canMoveGroup } from '../group-tree'

function parentsOf(groups: CollectionGroup[]): Map<string, string | null> {
  return new Map(groups.map(group => [group.id, group.parentId]))
}

export function groupPath(
  groups: CollectionGroup[],
  id: string | null,
): string {
  const names = new Map(groups.map(group => [group.id, group.name]))
  return ancestorIds(parentsOf(groups), id)
    .reverse()
    .map(id => names.get(id))
    .join(' / ')
}

export function canParentGroup(
  groups: CollectionGroup[],
  id: string,
  parentId: string | null,
): boolean {
  return canMoveGroup(parentsOf(groups), id, parentId)
}

export function organizationError(
  organization: CollectionOrganization,
): string | null {
  const { groups, placements } = organization
  if (new Set(groups.map(group => group.id)).size !== groups.length)
    return 'Group IDs must be unique'
  if (groups.some(group => !group.id.trim() || !group.name.trim()))
    return 'Groups need an ID and a name'
  const parents = parentsOf(groups)
  if (groups.some(group => !canMoveGroup(parents, group.id, group.parentId)))
    return 'Groups cannot contain themselves or have missing parents'
  const ids = new Set(groups.map(group => group.id))
  if (placements.some(placement => !ids.has(placement.groupId)))
    return 'Collection group does not exist'
  if (
    new Set(placements.map(placement => placement.collectionId)).size !==
    placements.length
  )
    return 'A collection can only belong to one group'
  return null
}

export function removeGroup(
  organization: CollectionOrganization,
  id: string,
): CollectionOrganization {
  const group = organization.groups.find(group => group.id === id)
  if (!group) return organization
  return {
    ...organization,
    groups: organization.groups
      .filter(group => group.id !== id)
      .map(child =>
        child.parentId === id ? { ...child, parentId: group.parentId } : child,
      ),
    placements: organization.placements.flatMap(placement => {
      if (placement.groupId !== id) return [placement]
      return group.parentId === null
        ? []
        : [{ ...placement, groupId: group.parentId }]
    }),
  }
}
