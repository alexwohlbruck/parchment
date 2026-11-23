import { describe, expect, it } from 'vitest'
import { LayerType, type Layer } from '@/types/map.types'
import { imageryStyle, moveInStack, resolveImageryStack } from './imagery-stack'

function layer(id: string, type = LayerType.IMAGERY, sourceType = 'raster'): Layer {
  return {
    id,
    type,
    configuration: {
      id,
      type: 'raster',
      source: { id, type: sourceType, tiles: [`https://${id}/{z}/{x}/{y}`] },
    },
  } as unknown as Layer
}

describe('resolveImageryStack', () => {
  it('keeps the chosen order and drops ids that are not imagery in the library', () => {
    const layers = [layer('b'), layer('a'), layer('overlay', LayerType.CUSTOM), layer('dem', LayerType.IMAGERY, 'raster-dem')]
    const stack = resolveImageryStack(['a', 'gone', 'overlay', 'dem', 'b'], layers)
    expect(stack.map(s => s.id)).toEqual(['a', 'b'])
    expect(stack[0].source).toEqual({ type: 'raster', tiles: ['https://a/{z}/{x}/{y}'] })
  })
})

describe('imageryStyle', () => {
  it('draws the top of the stack last so lower sources fill its gaps', () => {
    const style = imageryStyle(resolveImageryStack(['top', 'fallback'], [layer('top'), layer('fallback')]))
    expect(style.layers.map(l => l.id)).toEqual(['imagery:fallback', 'imagery:top'])
    expect(Object.keys(style.sources)).toEqual(['imagery:top', 'imagery:fallback'])
  })
})

describe('moveInStack', () => {
  it('swaps with a neighbour and ignores moves past either end', () => {
    expect(moveInStack(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(moveInStack(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
    expect(moveInStack(['a', 'b'], 'b', 1)).toEqual(['a', 'b'])
  })
})
