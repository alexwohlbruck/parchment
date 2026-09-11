/**
 * Which ways the map paints as cycling infrastructure, and how those layers
 * are named.
 *
 * Shared between the style generator, which builds a green twin of every road
 * surface, and the app, which switches them on with the cycling layer group.
 * Both have to agree on the naming or the toggle finds nothing to toggle.
 */

/** Appended to the id of the road layer a cycling twin is derived from. */
export const CYCLING_SUFFIX = ' (cycling)'

/**
 * A way that is cycling infrastructure in its own right.
 *
 * `subclass = cycleway` is `highway=cycleway` — a way built for bikes, which
 * is designated whether or not anyone tagged it so. `bicycle = designated`
 * is the same statement made about a road or a footpath that also carries
 * other traffic.
 *
 * Deliberately NOT `bicycle = yes`. That is permission, not provision, and it
 * is on most of the residential grid — tinting it paints whole neighbourhoods
 * green and says nothing, which is the failure mode of every bike map that
 * draws access rather than infrastructure.
 */
export function isCyclingWay() {
  return [
    'any',
    ['==', ['get', 'subclass'], 'cycleway'],
    ['==', ['get', 'bicycle'], 'designated'],
  ]
}
