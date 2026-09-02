import { describe, it, expect } from 'vitest'
import {
  addToStack,
  appendToStack,
  canvasStack,
  dissolveGroup,
  groupContents,
  groupOptions,
  moveInStack,
  removeFromStack,
  stackDrawOrder,
  type StackEntry,
} from './canvas-stack'
import type {
  CanvasAnnotation,
  CanvasBody,
  CanvasLayer,
} from '@/types/canvas.types'

/**
 * Layers and marks are one stack now, and what covers what is exactly what
 * the list says. The awkward cases are all about `order` disagreeing with the
 * buckets: a canvas saved before the merge has no order at all, and one saved
 * since can still be handed something the order has never heard of.
 */

function layer(id: string, visible = true): CanvasLayer {
  return { id, kind: 'style', name: id, visible, configuration: {} } as CanvasLayer
}

function mark(id: string): CanvasAnnotation {
  return { id, tool: 'pin', positions: [[0, 0]] } as CanvasAnnotation
}

function ids(entries: StackEntry[]) {
  return entries.map(entry => entry.id)
}

describe('a canvas saved before the lists merged', () => {
  const body: CanvasBody = {
    layers: [layer('l1'), layer('l2')],
    annotations: [mark('a1')],
  }

  it('reads as every layer and then every mark, the order it used to draw in', () => {
    expect(ids(canvasStack(body))).toEqual(['l1', 'l2', 'a1'])
  })
})

describe('a canvas with an order of its own', () => {
  const body: CanvasBody = {
    layers: [layer('l1'), layer('l2')],
    annotations: [mark('a1')],
    order: ['a1', 'l2', 'l1'],
  }

  it('reads in that order, marks and layers alike', () => {
    expect(ids(canvasStack(body))).toEqual(['a1', 'l2', 'l1'])
  })

  it('puts anything the order has never heard of on top', () => {
    const withNew = {
      ...body,
      layers: [...body.layers, layer('l3')],
      annotations: [...(body.annotations ?? []), mark('a2')],
    }
    expect(ids(canvasStack(withNew))).toEqual(['a1', 'l2', 'l1', 'l3', 'a2'])
  })

  it('ignores an id in the order that no longer exists', () => {
    expect(ids(canvasStack({ ...body, order: ['gone', 'l1'] }))).toEqual([
      'l1',
      'l2',
      'a1',
    ])
  })

  it('never places the same thing twice', () => {
    expect(ids(canvasStack({ ...body, order: ['l1', 'l1', 'l2'] }))).toEqual([
      'l1',
      'l2',
      'a1',
    ])
  })
})

describe('groups', () => {
  const body: CanvasBody = {
    layers: [layer('l1'), layer('l2')],
    annotations: [mark('a1')],
    groups: [
      { id: 'g1', name: 'Route', visible: true, children: ['l2', 'a1'] },
    ],
    order: ['l1', 'g1'],
  }

  it('hold their contents rather than leaving them loose in the stack', () => {
    const stack = canvasStack(body)
    expect(ids(stack)).toEqual(['l1', 'g1'])
    const group = stack[1]
    expect(group.kind).toBe('group')
    expect(group.kind === 'group' && ids(group.children)).toEqual(['l2', 'a1'])
  })

  it('draw their contents in place, between what is above and below', () => {
    expect(stackDrawOrder(canvasStack(body)).map(d => d.item.id)).toEqual([
      'l1',
      'l2',
      'a1',
    ])
  })

  it('take everything inside off the map when switched off', () => {
    const hidden = {
      ...body,
      groups: [{ ...body.groups![0], visible: false }],
    }
    expect(stackDrawOrder(canvasStack(hidden))).toEqual([
      { item: expect.objectContaining({ id: 'l1' }), visible: true },
      { item: expect.objectContaining({ id: 'l2' }), visible: false },
      { item: expect.objectContaining({ id: 'a1' }), visible: false },
    ])
  })

  it('still hide a layer that hides itself', () => {
    const inside = {
      ...body,
      layers: [layer('l1'), layer('l2', false)],
    }
    const drawn = stackDrawOrder(canvasStack(inside))
    expect(drawn.find(d => d.item.id === 'l2')?.visible).toBe(false)
  })

  it('report what is filed in them', () => {
    expect(groupContents(body, 'g1')).toEqual(['l2', 'a1'])
    expect(groupContents(body, 'nope')).toEqual([])
  })
})

describe('moving something in the stack', () => {
  const body: CanvasBody = {
    layers: [layer('l1'), layer('l2')],
    annotations: [mark('a1')],
  }

  it('drops a mark below a layer when that is where it landed', () => {
    const next = moveInStack(body, 'a1', { groupId: null, index: 0 })
    expect(next.order).toEqual(['a1', 'l1', 'l2'])
    expect(ids(canvasStack(next))).toEqual(['a1', 'l1', 'l2'])
  })

  it('never loses the thing it moved', () => {
    const next = moveInStack(body, 'l1', { groupId: null, index: 2 })
    expect(next.layers.map(l => l.id).sort()).toEqual(['l1', 'l2'])
    expect(next.annotations?.map(a => a.id)).toEqual(['a1'])
  })

  it('clamps an index past the end rather than leaving a hole', () => {
    const next = moveInStack(body, 'l1', { groupId: null, index: 99 })
    expect(next.order).toEqual(['l2', 'a1', 'l1'])
  })
})

describe('moving something into and out of a group', () => {
  const body: CanvasBody = {
    layers: [layer('l1'), layer('l2')],
    annotations: [mark('a1')],
    groups: [{ id: 'g1', name: 'Base', visible: true, children: [] }],
    order: ['l1', 'l2', 'a1', 'g1'],
  }

  const inGroup = (b: CanvasBody, id: string) =>
    (b.groups ?? []).find(g => g.id === 'g1')?.children.includes(id) ?? false

  it('files it in the group and takes it out of the top level', () => {
    const next = moveInStack(body, 'l2', { groupId: 'g1', index: 0 })
    expect(inGroup(next, 'l2')).toBe(true)
    expect(next.order).toEqual(['l1', 'a1', 'g1'])
  })

  it('keeps it in the body, so it is moved rather than deleted', () => {
    const next = moveInStack(body, 'l2', { groupId: 'g1', index: 0 })
    expect(next.layers.map(l => l.id)).toEqual(['l1', 'l2'])
    expect(ids(canvasStack(next))).toEqual(['l1', 'a1', 'g1'])
    const group = canvasStack(next).find(e => e.id === 'g1')
    expect(group?.kind === 'group' && ids(group.children)).toEqual(['l2'])
  })

  it('takes it back out again at the position it was dropped', () => {
    const inside = moveInStack(body, 'l2', { groupId: 'g1', index: 0 })
    const out = moveInStack(inside, 'l2', { groupId: null, index: 0 })
    expect(inGroup(out, 'l2')).toBe(false)
    expect(out.order).toEqual(['l2', 'l1', 'a1', 'g1'])
  })

  it('moves it straight from one group to another', () => {
    const two: CanvasBody = {
      ...body,
      groups: [
        { id: 'g1', name: 'Base', visible: true, children: ['l2'] },
        { id: 'g2', name: 'Marks', visible: true, children: [] },
      ],
      order: ['l1', 'a1', 'g1', 'g2'],
    }
    const next = moveInStack(two, 'l2', { groupId: 'g2', index: 0 })
    expect(next.groups?.find(g => g.id === 'g1')?.children).toEqual([])
    expect(next.groups?.find(g => g.id === 'g2')?.children).toEqual(['l2'])
    expect(next.order).toEqual(['l1', 'a1', 'g1', 'g2'])
  })

  it('reorders within a group without touching the stack', () => {
    const filled: CanvasBody = {
      ...body,
      groups: [{ id: 'g1', name: 'Base', visible: true, children: ['l2', 'a1'] }],
      order: ['l1', 'g1'],
    }
    const next = moveInStack(filled, 'a1', { groupId: 'g1', index: 0 })
    expect(next.groups?.[0].children).toEqual(['a1', 'l2'])
    expect(next.order).toEqual(['l1', 'g1'])
  })

  it('leaves it visible when the group it was aimed at has gone', () => {
    const next = moveInStack(body, 'l2', { groupId: 'missing', index: 0 })
    expect(ids(canvasStack(next))).toContain('l2')
  })
})

describe('adding and removing', () => {
  const body: CanvasBody = {
    layers: [layer('l1')],
    annotations: [],
    groups: [{ id: 'g1', name: 'Route', visible: true, children: ['l2'] }],
    order: ['l1', 'g1'],
  }

  it('puts something new on top', () => {
    expect(appendToStack(body, 'l9')).toEqual(['l1', 'g1', 'l9'])
  })

  it('does not add something already in the stack twice', () => {
    expect(appendToStack(body, 'l1')).toEqual(['l1', 'g1'])
  })

  it('takes a removed item out of the group holding it', () => {
    const next = removeFromStack({ ...body, order: ['l1', 'g1', 'l2'] }, 'l2')
    expect(next.order).toEqual(['l1', 'g1'])
    expect(next.groups?.[0].children).toEqual([])
  })
})

describe('groups inside groups', () => {
  const nested: CanvasBody = {
    layers: [layer('l1'), layer('l2')],
    annotations: [mark('a1')],
    groups: [
      { id: 'g1', name: 'Transit', visible: true, children: ['l1', 'g2'] },
      { id: 'g2', name: 'Rail', visible: true, children: ['l2', 'a1'] },
    ],
    order: ['g1'],
  }

  const find = (entries: StackEntry[], id: string): StackEntry | undefined => {
    for (const entry of entries) {
      if (entry.id === id) return entry
      if (entry.kind === 'group') {
        const found = find(entry.children, id)
        if (found) return found
      }
    }
  }

  it('holds a group the way it holds anything else', () => {
    const stack = canvasStack(nested)
    expect(ids(stack)).toEqual(['g1'])
    const outer = stack[0]
    expect(outer.kind === 'group' && ids(outer.children)).toEqual(['l1', 'g2'])
    const inner = find(stack, 'g2')
    expect(inner?.kind === 'group' && ids(inner.children)).toEqual(['l2', 'a1'])
  })

  it('leaves a nested group where its parent holds it, not at the top', () => {
    // Only `g1` is in the order — `g2` is reachable through it, and hoisting
    // it to the top level would empty its parent out.
    expect(ids(canvasStack(nested))).not.toContain('g2')
  })

  it('draws everything in one flat pass, deepest contents in place', () => {
    expect(stackDrawOrder(canvasStack(nested)).map(d => d.item.id)).toEqual([
      'l1',
      'l2',
      'a1',
    ])
  })

  it('takes a whole branch off the map when a group above it is switched off', () => {
    const hidden = {
      ...nested,
      groups: [{ ...nested.groups![0], visible: false }, nested.groups![1]],
    }
    // `g2` still says it is visible; its parent is what decides.
    expect(stackDrawOrder(canvasStack(hidden))).toEqual([
      { item: expect.objectContaining({ id: 'l1' }), visible: false },
      { item: expect.objectContaining({ id: 'l2' }), visible: false },
      { item: expect.objectContaining({ id: 'a1' }), visible: false },
    ])
  })

  it('hides only the inner branch when the inner group is the one off', () => {
    const hidden = {
      ...nested,
      groups: [nested.groups![0], { ...nested.groups![1], visible: false }],
    }
    const drawn = stackDrawOrder(canvasStack(hidden))
    expect(drawn.find(d => d.item.id === 'l1')?.visible).toBe(true)
    expect(drawn.find(d => d.item.id === 'l2')?.visible).toBe(false)
  })

  it('shows a group whose holder was deleted rather than losing it', () => {
    // `g1` is gone, so `g2` comes back to the top level with its contents
    // intact, and the layer `g1` was holding is loose again rather than lost.
    const orphaned = { ...nested, groups: [nested.groups![1]] }
    expect(ids(canvasStack(orphaned))).toEqual(['g2', 'l1'])
    expect(stackDrawOrder(canvasStack(orphaned)).map(d => d.item.id)).toEqual([
      'l2',
      'a1',
      'l1',
    ])
  })

  it('terminates on a group that ends up holding itself', () => {
    const cyclic: CanvasBody = {
      layers: [layer('l1')],
      groups: [
        { id: 'g1', name: 'One', visible: true, children: ['g2'] },
        { id: 'g2', name: 'Two', visible: true, children: ['g1', 'l1'] },
      ],
      order: [],
    }
    const stack = canvasStack(cyclic)
    // Whatever it does with the loop, everything is shown exactly once.
    expect(stackDrawOrder(stack).map(d => d.item.id)).toEqual(['l1'])
  })

  it('lists every group with how deep it sits, for the destination picker', () => {
    expect(groupOptions(canvasStack(nested))).toEqual([
      { id: 'g1', name: 'Transit', depth: 0 },
      { id: 'g2', name: 'Rail', depth: 1 },
    ])
  })
})

describe('moving a group', () => {
  const body: CanvasBody = {
    layers: [layer('l1')],
    groups: [
      { id: 'g1', name: 'Transit', visible: true, children: [] },
      { id: 'g2', name: 'Rail', visible: true, children: [] },
    ],
    order: ['l1', 'g1', 'g2'],
  }

  it('files one group inside another', () => {
    const next = moveInStack(body, 'g2', { groupId: 'g1', index: 0 })
    expect(next.groups?.find(g => g.id === 'g1')?.children).toEqual(['g2'])
    expect(next.order).toEqual(['l1', 'g1'])
  })

  it('refuses to file a group inside itself', () => {
    expect(moveInStack(body, 'g1', { groupId: 'g1', index: 0 })).toBe(body)
  })

  it('refuses to file a group inside something it already holds', () => {
    // The branch would leave the tree with it, taking everything in it away.
    const deep: CanvasBody = {
      ...body,
      groups: [
        { id: 'g1', name: 'Transit', visible: true, children: ['g2'] },
        { id: 'g2', name: 'Rail', visible: true, children: ['g3'] },
        { id: 'g3', name: 'Metro', visible: true, children: [] },
      ],
      order: ['l1', 'g1'],
    }
    expect(moveInStack(deep, 'g1', { groupId: 'g3', index: 0 })).toBe(deep)
  })
})

describe('filing something new where the user is working', () => {
  const body: CanvasBody = {
    layers: [layer('l1')],
    annotations: [],
    groups: [{ id: 'g1', name: 'Transit', visible: true, children: ['l2'] }],
    order: ['l1', 'g1'],
  }

  it('puts it on top of the group that is the destination', () => {
    const next = addToStack(body, 'a1', 'g1')
    expect(next.groups?.[0].children).toEqual(['l2', 'a1'])
    // Filed in the group, so the top level is left alone.
    expect(next.order).toEqual(['l1', 'g1'])
  })

  it('puts it on top of the stack when the canvas itself is the destination', () => {
    expect(addToStack(body, 'a1', null).order).toEqual(['l1', 'g1', 'a1'])
  })

  it('falls back to the top rather than losing it when the group has gone', () => {
    expect(addToStack(body, 'a1', 'deleted').order).toEqual(['l1', 'g1', 'a1'])
  })
})

describe('ungrouping', () => {
  it('leaves the contents where the group was, in the order they were in', () => {
    const body: CanvasBody = {
      layers: [layer('l1'), layer('l2')],
      annotations: [mark('a1')],
      groups: [{ id: 'g1', name: 'Transit', visible: true, children: ['l2', 'a1'] }],
      order: ['l1', 'g1'],
    }
    const next = dissolveGroup(body, 'g1')
    expect(next.order).toEqual(['l1', 'l2', 'a1'])
    expect(next.groups).toEqual([])
    expect(ids(canvasStack(next))).toEqual(['l1', 'l2', 'a1'])
  })

  it('leaves them inside the parent when the group was nested', () => {
    const body: CanvasBody = {
      layers: [layer('l1'), layer('l2')],
      groups: [
        { id: 'g1', name: 'Transit', visible: true, children: ['l1', 'g2'] },
        { id: 'g2', name: 'Rail', visible: true, children: ['l2'] },
      ],
      order: ['g1'],
    }
    const next = dissolveGroup(body, 'g2')
    expect(next.groups).toEqual([
      { id: 'g1', name: 'Transit', visible: true, children: ['l1', 'l2'] },
    ])
    expect(ids(canvasStack(next))).toEqual(['g1'])
  })
})
