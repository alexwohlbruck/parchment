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
 * A road or footpath MARKED for bikes — the kind of way whose own surface is
 * painted green, because riding it means riding that street.
 *
 * `highway = cycleway` is deliberately excluded even though it qualifies on
 * every other reading: a dedicated bike path is not a road that allows bikes,
 * it is its own piece of infrastructure, and it keeps its own cased mark. See
 * the cycling layer templates.
 *
 * `bicycle = yes` is excluded too. That is permission, not provision, and it
 * is on most of the residential grid — tinting it paints whole neighbourhoods
 * green and says nothing, which is the failure mode of every bike map that
 * draws access rather than infrastructure.
 */
export function isCyclingWay() {
  return [
    'all',
    ['==', ['get', 'bicycle'], 'designated'],
    ['!=', ['get', 'subclass'], 'cycleway'],
  ]
}
