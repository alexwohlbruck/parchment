import { describe, it, expect } from 'vitest'
import {
  ancestorIds,
  canMoveGroup,
  descendantIds,
  buildGroupHierarchy,
  groupItemCounts,
} from './group-tree'

const parents = new Map<string, string | null>([
  ['us', null],
  ['ny', 'us'],
  ['food', 'ny'],
  ['la', 'us'],
])

describe('shared group traversal', () => {
  it('walks ancestors without looping on malformed parentage', () => {
    expect(ancestorIds(parents, 'food')).toEqual(['food', 'ny', 'us'])
    expect(
      ancestorIds(
        new Map([
          ['a', 'b'],
          ['b', 'a'],
        ]),
        'a',
      ),
    ).toEqual(['a', 'b'])
    expect(ancestorIds(parents, 'missing')).toEqual([])
  })

  it('accepts valid moves and rejects descendants, missing parents and cycles', () => {
    expect(canMoveGroup(parents, 'ny', 'la')).toBe(true)
    expect(canMoveGroup(parents, 'ny', null)).toBe(true)
    expect(canMoveGroup(parents, 'ny', 'food')).toBe(false)
    expect(canMoveGroup(parents, 'ny', 'missing')).toBe(false)
    expect(
      canMoveGroup(
        new Map([
          ['a', 'b'],
          ['b', 'a'],
          ['c', null],
        ]),
        'c',
        'a',
      ),
    ).toBe(false)
  })

  it('finds descendants in child lists and terminates on cycles', () => {
    const children = new Map([
      ['us', ['ny', 'la', 'not-a-group']],
      ['ny', ['food']],
      ['food', []],
      ['la', []],
    ])
    expect([...descendantIds(children, 'us')]).toEqual(['ny', 'la', 'food'])
    expect([
      ...descendantIds(
        new Map([
          ['a', ['b']],
          ['b', ['a']],
        ]),
        'a',
      ),
    ]).toEqual(['b', 'a'])
  })

  it('nests groups in supplied order, keeping orphaned groups accessible', () => {
    const groups = [
      { id: 'ny', parentId: 'us' },
      { id: 'us', parentId: null },
      { id: 'orphan', parentId: 'gone' },
    ]
    const tree = buildGroupHierarchy(groups, group => group.parentId)
    expect(tree.map(node => node.value.id)).toEqual(['us', 'orphan'])
    expect(tree[0].children[0].value.id).toBe('ny')
  })

  it('keeps each group visible once even when the stored hierarchy cycles', () => {
    const tree = buildGroupHierarchy(
      [
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ],
      group => group.parentId,
    )
    expect(tree).toHaveLength(1)
    expect(tree[0].value.id).toBe('a')
    expect(tree[0].children[0].value.id).toBe('b')
    expect(tree[0].children[0].children).toEqual([])
  })

  it('counts descendants once for both grouped collections and layers', () => {
    expect(
      groupItemCounts(
        parents,
        new Map([
          ['ny', 2],
          ['food', 3],
          ['la', 1],
        ]),
      ),
    ).toEqual(
      new Map([
        ['food', 3],
        ['ny', 5],
        ['la', 1],
        ['us', 6],
      ]),
    )
  })
})
