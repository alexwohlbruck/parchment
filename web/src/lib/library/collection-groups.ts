export {
  groupPath,
  canParentGroup,
  removeGroup,
  organizationError,
} from '@server/lib/library/collection-groups'

import { ancestorIds } from '@/lib/group-tree'

import type {
  CollectionGroup,
  CollectionPlacement,
} from '@/types/collection-groups.types'

export function filterCollectionGroups(
  groups: CollectionGroup[],
  placements: CollectionPlacement[],
  collectionIds: string[],
  matchingGroupIds: string[] = [],
): CollectionGroup[] {
  const collections = new Set(collectionIds)
  const visible = new Set<string>()
  const targets = [
    ...placements
      .filter(placement => collections.has(placement.collectionId))
      .map(placement => placement.groupId),
    ...matchingGroupIds,
  ]
  const parents = new Map(groups.map(group => [group.id, group.parentId]))
  for (const id of targets) {
    for (const ancestor of ancestorIds(parents, id)) visible.add(ancestor)
  }
  return groups.filter(group => visible.has(group.id))
}
