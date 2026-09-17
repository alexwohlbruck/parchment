/**
 * Where the basemap's tunnel and bridge bands end.
 *
 * A way's brunnel decides which band draws it, not which layer: a road tunnel
 * goes under the whole surface network and a path bridge goes over it, each in
 * its own block of layers. So anything painted onto a way — a cycling mark, a
 * route corridor — has to land in the band its way belongs to, or the basemap
 * simply redraws the way on top of the paint. That is how the cycling network
 * lost its mark at every footbridge.
 *
 * Read off the filters rather than off layer ids, so a restyle that renames or
 * adds a bridge layer cannot strand an anchor on a layer that moved.
 */

import { SOURCE } from './build'

export type BrunnelLayer = {
  id: string
  type: string
  source?: string
  filter?: unknown
  'source-layer'?: string
}

/** The road network, and the layers that paint onto it. */
const NETWORK_SOURCES = ['transportation', 'bicycle_ways']

/** `brunnel` in a legacy filter, or read through `get` in an expression. */
const isBrunnelKey = (operand: unknown, key: string) =>
  operand === key ||
  (Array.isArray(operand) &&
    operand[0] === 'get' &&
    operand[1] === key)

/**
 * Whether a filter ASSERTS a brunnel, rather than merely mentioning one.
 *
 * Every surface layer names both values to exclude them — `Path` is
 * `brunnel != bridge` and `brunnel != tunnel` — so a filter that contains the
 * word says nothing about which band the layer draws in. Only an equality
 * does, and it can sit nested: a path bridge is `brunnel == bridge` OR
 * `layer > 0`.
 */
function asserts(filter: unknown, key: string, value: unknown): boolean {
  if (!Array.isArray(filter)) return false
  const [op, left, right] = filter
  if (op === '==' && isBrunnelKey(left, key) && right === value) return true
  return filter.some(part => asserts(part, key, value))
}

/**
 * Barrelman serves `bridge` and `tunnel` as their own booleans, so a layer
 * painted from its tiles states the brunnel differently to one filtering the
 * basemap's `brunnel` string. Both count: they draw in the same band.
 */
const draws = (layer: BrunnelLayer, brunnel: 'bridge' | 'tunnel') =>
  NETWORK_SOURCES.includes(layer['source-layer'] ?? '') &&
  (asserts(layer.filter, 'brunnel', brunnel) ||
    asserts(layer.filter, brunnel, true))

const bandEnd = (
  layers: readonly BrunnelLayer[],
  brunnel: 'bridge' | 'tunnel',
): number | undefined => {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (draws(layers[i], brunnel)) return i + 1
  }
  return undefined
}

/**
 * The index the first layer above the basemap's tunnels occupies — the place a
 * mark on a tunnel goes, so the surface network still draws over it where the
 * two cross and the way visibly dips under.
 *
 * A mark already drawn there counts as part of the band, so a second one lands
 * above the first and a casing stays under its stroke.
 */
export const aboveTunnelsIndex = (layers: readonly BrunnelLayer[]) =>
  bandEnd(layers, 'tunnel')

/**
 * The first thing the BASEMAP draws above its bridges — the top of the ground,
 * since a bridge deck is the last thing the network draws.
 *
 * Basemap, because an anchor is a position and overlays are inserted at it: one
 * that answered `whatever sits here now` would name the layer added last, and
 * every further layer would slide underneath it in reverse.
 */
export function aboveBridgesIndex(
  layers: readonly BrunnelLayer[],
): number | undefined {
  const end = bandEnd(layers, 'bridge')
  if (end === undefined) return undefined
  for (let i = end; i < layers.length; i++) {
    if (layers[i].source === SOURCE) return i
  }
  return layers.length
}
