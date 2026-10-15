/**
 * Stairs: OpenMapTiles carries `highway=steps` as `class=path, subclass=steps`,
 * which MapTiler's spec draws as any other footpath. Hand-authored because
 * `spec.json` is regenerated wholesale.
 */

export const STEPS_LAYER = 'Steps'
export const STEPS_BRIDGE_LAYER = 'Steps bridge'

const BANDS = [
  { id: STEPS_LAYER, path: 'Path', casing: 'Path outline' },
  { id: STEPS_BRIDGE_LAYER, path: 'Path bridge', casing: 'Path outline bridge' },
]

// Dash and gap in multiples of the line width, so treads keep their spacing
// relative to the path as it widens.
const TREADS = [0.25, 0.5]

/**
 * Treads dashed across each band's path surface, in that band's casing colour,
 * keyed by the path layer they belong above.
 */
export function stepsLayers(layers: any[]): { above: string; layer: any }[] {
  const byId = (id: string) => layers.find(l => l.id === id)
  return BANDS.flatMap(({ id, path, casing }) => {
    const surface = byId(path)
    const outline = byId(casing)
    if (!surface || !outline) return []
    return [{
      above: path,
      layer: {
        id,
        type: 'line',
        source: surface.source,
        'source-layer': surface['source-layer'],
        minzoom: 17,
        filter: ['all', surface.filter, ['==', ['get', 'subclass'], 'steps']],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': outline.paint['line-color'],
          'line-width': surface.paint['line-width'],
          'line-dasharray': TREADS,
        },
      },
    }]
  })
}
