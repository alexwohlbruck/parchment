import { describe, expect, it } from 'vitest'
import { LayerType, type Layer } from '@/types/map.types'
import { PHOTOREALISTIC_MIN_ZOOM, availableImagery, imageryStyle, photorealisticSource, resolveImageryStack } from './imagery-stack'

function layer(id: string, type = LayerType.IMAGERY, sourceType = 'raster'): Layer {
  return {
    id,
    type,
    configuration: {
      id,
      type: 'raster',
      source: { id, type: sourceType, tiles: [`https://${id}/{z}/{x}/{y}`], url: `https://${id}/root.json` },
    },
  } as unknown as Layer
}

describe('resolveImageryStack', () => {
  it('keeps the chosen order and drops ids that are not imagery in the library', () => {
    const layers = [layer('b'), layer('a'), layer('overlay', LayerType.CUSTOM), layer('dem', LayerType.IMAGERY, 'raster-dem')]
    const stack = resolveImageryStack(['a', 'gone', 'overlay', 'dem', 'b'], layers)
    expect(stack.map(s => s.id)).toEqual(['a', 'b'])
    expect(stack[0]).toMatchObject({ kind: 'raster', source: { type: 'raster', tiles: ['https://a/{z}/{x}/{y}'] } })
  })

  it('keeps 3D tiles as their own kind, out of the style', () => {
    const stack = resolveImageryStack(['mesh', 'a'], [layer('a'), layer('mesh', LayerType.IMAGERY, '3d-tiles')])
    expect(photorealisticSource(stack)).toMatchObject({ id: 'mesh', kind: '3d-tiles' })
    expect(imageryStyle(stack).layers.map(l => l.id)).toEqual(['imagery:a'])
  })

  it('stops the rasters where the 3D tiles start', () => {
    const flat = imageryStyle(resolveImageryStack(['a'], [layer('a')]))
    const under3d = imageryStyle(resolveImageryStack(['mesh', 'a'], [layer('a'), layer('mesh', LayerType.IMAGERY, '3d-tiles')]))
    expect(flat.layers[0].maxzoom).toBeUndefined()
    expect(under3d.layers[0].maxzoom).toBe(PHOTOREALISTIC_MIN_ZOOM)
  })
})

describe('imageryStyle', () => {
  it('draws the top of the stack last so lower sources fill its gaps', () => {
    const style = imageryStyle(resolveImageryStack(['top', 'fallback'], [layer('top'), layer('fallback')]))
    expect(style.layers.map(l => l.id)).toEqual(['imagery:fallback', 'imagery:top'])
    expect(Object.keys(style.sources)).toEqual(['imagery:top', 'imagery:fallback'])
  })
})

describe('availableImagery', () => {
  const layers = [layer('a'), layer('mesh', LayerType.IMAGERY, '3d-tiles'), layer('overlay', LayerType.CUSTOM)]

  it('holds Photorealistic 3D back from users without it', () => {
    expect(availableImagery(layers, false).map(l => l.id)).toEqual(['a'])
    expect(availableImagery(layers, true).map(l => l.id)).toEqual(['a', 'mesh'])
  })
})
