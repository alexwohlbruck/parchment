/**
 * A source layer's loaded features, each tile's read once and kept until the
 * tile reloads: `querySourceFeatures` builds every feature afresh on each
 * call, and its geometry is decoded again with it. Not to be mutated.
 */
type Reading = { features: any[]; next: number; length: number }

const read = new WeakMap<object, Map<string, Reading>>()

/** Features read between yields: a dense layer of one tile is tens of thousands, and far more than a frame's work. */
const CHUNK = 512

/** A tile's features in a source layer, read a chunk a step; two readers of one tile share the reading. */
function* tileFeatureSteps(tile: any, sourceLayer: string): Generator<void, any[]> {
  const index = tile?.latestFeatureIndex
  if (!index?.rawTileData) return []
  let layers = read.get(index)
  if (!layers) read.set(index, (layers = new Map()))
  let reading = layers.get(sourceLayer)
  if (!reading) layers.set(sourceLayer, (reading = { features: [], next: 0, length: Infinity }))
  while (reading.next < reading.length) {
    if (tile.latestFeatureIndex !== index) return []
    const from = reading.next
    reading.next += CHUNK
    reading.length = tile.querySourceFeatures(reading.features, { sourceLayer, range: [from, from + CHUNK] })
    if (reading.next < reading.length) yield
  }
  return reading.features
}

function loadedTiles(map: any, source: string): any[] | null {
  const manager = map.style?.tileManagers?.[source]
  if (!manager?.getRenderableIds) return null
  const tiles = new Map<string, any>()
  for (const id of manager.getRenderableIds()) {
    const tile = manager.getTileByID(id)
    if (tile && !tiles.has(tile.tileID.canonical.key)) tiles.set(tile.tileID.canonical.key, tile)
  }
  return [...tiles.values()]
}

/** Each loaded tile's features in a source layer, one array per tile, kept the same until the tile reloads; yields while reading. */
export function* sourceTileFeatureSteps(map: any, source: string, sourceLayer = ''): Generator<void, any[][]> {
  try {
    const tiles = loadedTiles(map, source)
    if (!tiles) return [map.querySourceFeatures(source, sourceLayer ? { sourceLayer } : {})]
    const features: any[][] = []
    for (const tile of tiles) features.push(yield* tileFeatureSteps(tile, sourceLayer))
    return features
  } catch {
    return []
  }
}

export function* sourceFeatureSteps(map: any, source: string, sourceLayer = ''): Generator<void, any[]> {
  return (yield* sourceTileFeatureSteps(map, source, sourceLayer)).flat()
}

function finish<T>(steps: Generator<void, T>): T {
  let step = steps.next()
  while (!step.done) step = steps.next()
  return step.value
}

export function sourceTileFeatures(map: any, source: string, sourceLayer = ''): any[][] {
  return finish(sourceTileFeatureSteps(map, source, sourceLayer))
}

export function sourceFeatures(map: any, source: string, sourceLayer = ''): any[] {
  return sourceTileFeatures(map, source, sourceLayer).flat()
}
