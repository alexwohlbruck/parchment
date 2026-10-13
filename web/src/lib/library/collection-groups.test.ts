import { describe, it, expect } from 'vitest'
import {
  canParentGroup,
  groupPath,
  organizationError,
  removeGroup,
  filterCollectionGroups,
} from './collection-groups'
import type { CollectionOrganization } from '@/types/collection-groups.types'

const organization: CollectionOrganization = {
  revision: 3,
  groups: [
    { id: 'us', name: 'United States', parentId: null },
    { id: 'ny', name: 'New York', parentId: 'us' },
    { id: 'food', name: 'Food', parentId: 'ny' },
    { id: 'la', name: 'Los Angeles', parentId: 'us' },
  ],
  placements: [
    { collectionId: 'restaurants', groupId: 'food' },
    { collectionId: 'parks', groupId: 'ny' },
  ],
}

describe('collection groups', () => {
  it('builds paths through nested groups', () => {
    expect(groupPath(organization.groups, 'food')).toBe(
      'United States / New York / Food',
    )
  })

  it('prevents moving a group into itself or a descendant', () => {
    expect(canParentGroup(organization.groups, 'ny', 'food')).toBe(false)
    expect(canParentGroup(organization.groups, 'ny', 'ny')).toBe(false)
    expect(canParentGroup(organization.groups, 'ny', 'missing')).toBe(false)
    expect(canParentGroup(organization.groups, 'ny', 'la')).toBe(true)
    expect(canParentGroup(organization.groups, 'ny', null)).toBe(true)
  })

  it('rejects cycles, duplicate IDs, missing groups and duplicate placements', () => {
    expect(organizationError(organization)).toBeNull()
    expect(
      organizationError({
        ...organization,
        groups: organization.groups.map(group =>
          group.id === 'us' ? { ...group, parentId: 'food' } : group,
        ),
      }),
    ).toBeTruthy()
    expect(
      organizationError({
        ...organization,
        groups: [...organization.groups, organization.groups[0]],
      }),
    ).toBeTruthy()
    expect(
      organizationError({
        ...organization,
        placements: [{ collectionId: 'a', groupId: 'missing' }],
      }),
    ).toBeTruthy()
    expect(
      organizationError({
        ...organization,
        placements: [...organization.placements, organization.placements[0]],
      }),
    ).toBeTruthy()
  })

  it('ungroups children and collections into the removed group’s parent', () => {
    const result = removeGroup(organization, 'ny')
    expect(result.groups.find(group => group.id === 'food')?.parentId).toBe(
      'us',
    )
    expect(
      result.placements.find(item => item.collectionId === 'parks')?.groupId,
    ).toBe('us')
    expect(
      result.placements.find(item => item.collectionId === 'restaurants')
        ?.groupId,
    ).toBe('food')
    expect(organization.groups).toHaveLength(4)
  })

  it('moves collections to the root when removing a root group', () => {
    const result = removeGroup(
      { ...organization, placements: [{ collectionId: 'a', groupId: 'us' }] },
      'us',
    )
    expect(result.placements).toEqual([])
    expect(result.groups.find(group => group.id === 'ny')?.parentId).toBeNull()
  })

  it('keeps ancestors of matching collections and hides unrelated branches', () => {
    expect(
      filterCollectionGroups(organization.groups, organization.placements, [
        'restaurants',
      ]).map(group => group.id),
    ).toEqual(['us', 'ny', 'food'])
    expect(
      filterCollectionGroups(
        organization.groups,
        organization.placements,
        [],
      ).map(group => group.id),
    ).toEqual([])
    expect(
      filterCollectionGroups(organization.groups, [], [], ['la']).map(
        group => group.id,
      ),
    ).toEqual(['us', 'la'])
  })
})
