export {
  groupPath,
  canParentGroup,
  removeGroup,
  organizationError,
} from '@server/lib/library/collection-groups'

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
  for (let id of targets) {
    while (id && !visible.has(id)) {
      visible.add(id)
      id = parents.get(id) ?? ''
    }
  }
  return groups.filter(group => visible.has(group.id))
}
