/**
 * Trees, the first of the 3D object layers.
 *
 * Almost no tree in OpenStreetMap carries a height — under 1% of the 300k in
 * the current extract — so the size of one is invented rather than read. It is
 * invented *deterministically*, from the feature id: a random height would
 * shimmer as tiles reload, where a hash gives the same tree the same shape
 * every time it is drawn, and the same variety across a street.
 *
 * `leaf_type` is the one attribute with real coverage (about 13%), and it is
 * the one that matters: it picks between the broadleaf and the conifer model.
 */
import { TREE_SOURCE, TREE_TILES } from '@/lib/map-style/detail-layers'
import type { ObjectInstance, ObjectSourceSpec } from './object-layer'

export const TREE_MODELS = {
  'tree-broadleaf': '/models/tree-broadleaf.glb',
  'tree-conifer': '/models/tree-conifer.glb',
}

/** Street trees run small; park and avenue trees are given their head. */
const HEIGHT = { min: 6, max: 13 }
const STREET_HEIGHT = { min: 5, max: 9 }

/** A canopy is wider than the trunk is tall in a young tree, narrower in an old one. */
const SPREAD_RATIO = { min: 0.55, max: 0.85 }

/**
 * A small integer hash, so every derived property of a tree is stable across
 * reloads and uncorrelated with the others. Three cheap mixes of the same id
 * rather than one, or height and heading would march in lockstep down a street.
 */
function hash(seed: string | number, salt: number): number {
  let h = 2166136261 ^ salt
  const text = String(seed)
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 8) & 0xffff) / 0xffff
}

const lerp = (range: { min: number; max: number }, t: number) =>
  range.min + (range.max - range.min) * t

export function treeInstance(feature: any, lng: number, lat: number): ObjectInstance | null {
  const props = feature.properties ?? {}
  const seed = props.id ?? feature.id ?? `${lng},${lat}`

  // A tagged height is rare and always better than a guess.
  const tagged = parseFloat(props.height)
  const street = props.denotation === 'street' || props.denotation === 'avenue'
  const height = Number.isFinite(tagged) && tagged > 1 && tagged < 90
    ? tagged
    : lerp(street ? STREET_HEIGHT : HEIGHT, hash(seed, 1))

  const conifer = props.leaf_type === 'needleleaved'
  return {
    lng,
    lat,
    height,
    // A conifer is a narrow thing; its spread is a fraction of a broadleaf's.
    spread: height * lerp(SPREAD_RATIO, hash(seed, 2)) * (conifer ? 0.6 : 1),
    heading: hash(seed, 3) * Math.PI * 2,
    // ±12% on the model's own greens, so a row of trees is not one flat block
    // of colour.
    shade: 0.88 + hash(seed, 4) * 0.24,
    model: conifer ? 'tree-conifer' : 'tree-broadleaf',
  }
}

export const TREE_OBJECTS: ObjectSourceSpec = {
  source: TREE_SOURCE,
  sourceLayer: TREE_TILES,
  // Matches the flat form's minzoom: the two are the same features, and a zoom
  // where one draws and the other does not would show as trees appearing twice.
  minzoom: 16,
  toInstance: treeInstance,
}
