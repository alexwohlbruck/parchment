import { latest } from '@maplibre/maplibre-gl-style-spec'

/**
 * The style properties our MapLibre fork adds, on the npm spec the tests
 * validate against: the fork registers them on its own bundled copy at runtime.
 */
export function registerForkSpec() {
  const spec = latest as any
  spec.layout_line['line-rounded-corner-distance'] ??= { ...spec['layout_fill-extrusion']['fill-extrusion-rounded-corner-distance'] }
  const paint = spec['paint_fill-extrusion']
  paint['fill-extrusion-cast-shadows'] ??= { ...paint['fill-extrusion-vertical-gradient'], default: false }
  paint['fill-extrusion-roof-color'] ??= { ...paint['fill-extrusion-color'] }
  paint['fill-extrusion-facade-style'] ??= { ...paint['fill-extrusion-base'], expression: { interpolated: false, parameters: ['zoom', 'feature', 'feature-state'] } }
  paint['fill-extrusion-facade-seed'] ??= { ...paint['fill-extrusion-facade-style'] }
}
