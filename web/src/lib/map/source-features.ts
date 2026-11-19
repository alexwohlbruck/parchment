/**
 * A source layer's loaded features, each tile's read once and kept until the
 * tile reloads: `querySourceFeatures` builds every feature afresh on each
 * call, and its geometry is decoded again with it. Not to be mutated.
 */
const read = new WeakMap<object, Map<string, any[]>>()

function tileFeatures(tile: any, sourceLayer: string): any[] {
  const index = tile?.latestFeatureIndex
  if (!index?.rawTileData) return []
  let layers = read.get(index)
  if (!layers) read.set(index, (layers = new Map()))
  let features = layers.get(sourceLayer)
  if (!features) {
    features = []
    tile.querySourceFeatures(features, { sourceLayer })
    layers.set(sourceLayer, features)
  }
  return features
}

export function sourceFeatures(map: any, source: string, sourceLayer = ''): any[] {
  try {
    const manager = map.style?.tileManagers?.[source]
    if (!manager?.getRenderableIds) return map.querySourceFeatures(source, sourceLayer ? { sourceLayer } : {})
    const tiles = new Map<string, any>()
    for (const id of manager.getRenderableIds()) {
      const tile = manager.getTileByID(id)
      if (tile && !tiles.has(tile.tileID.canonical.key)) tiles.set(tile.tileID.canonical.key, tile)
    }
    return [...tiles.values()].flatMap(tile => tileFeatures(tile, sourceLayer))
  } catch {
    return []
  }
}
