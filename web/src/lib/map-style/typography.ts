import type { Typography } from './themes'
import { NEIGHBOURHOOD_LAYER } from './neighbourhood-labels'

const GEIST = 'Geist '
const ROAD_LABELS = 'Road labels'
const PLACE_LABELS = 'Place labels'
const DEFAULT_TEXT_SIZE = 16
const DISTRICTS = ['suburb', 'neighborhood', 'neighbourhood', 'quarter']

/** Every label in the theme's family at Geist's weights, with its road and district names set its way. */
export function withTypography(layers: any[], typography: Typography | undefined): any[] {
  if (!typography) return layers
  const swap = (font: any): any =>
    typeof font === 'string' && font.startsWith(GEIST) ? `${typography.family} ${font.slice(GEIST.length)}`
      : Array.isArray(font) ? font.map(swap) : font
  const faces = new Map(typography.layerFaces?.flatMap(face => face.layers.map(id => [id, face])))
  return layers.map(layer => {
    const font = layer.layout?.['text-font']
    if (!font) return layer
    const layout = { ...layer.layout, 'text-font': swap(font) }
    const { textScale } = typography
    if (textScale) layout['text-size'] = scaleStops(layout['text-size'] ?? DEFAULT_TEXT_SIZE, size => typeof size === 'number' ? size * textScale : ['*', size, textScale])
    const face = faces.get(layer.id)
    if (face) {
      layout['text-font'] = ['literal', [face.font]]
      if (face.letterSpacing !== undefined) layout['text-letter-spacing'] = face.letterSpacing
      if (face.transform) layout['text-transform'] = face.transform
    }
    if (layer.id === ROAD_LABELS && typography.roadLabels) {
      layout['text-transform'] = typography.roadLabels.transform
      layout['text-letter-spacing'] = typography.roadLabels.letterSpacing
    }
    const districts = typography.districtLabels
    if (districts && layer.id === NEIGHBOURHOOD_LAYER) {
      layout['text-font'] = ['literal', [districts.font]]
      layout['text-letter-spacing'] = districts.letterSpacing
      layout['text-size'] = scaleStops(layout['text-size'], size => ['*', size, districts.scale])
    }
    if (districts && layer.id === PLACE_LABELS) {
      const isDistrict = ['in', ['get', 'class'], ['literal', DISTRICTS]]
      layout['text-font'] = ['case', isDistrict, ['literal', [districts.font]], ['literal', layout['text-font']]]
      layout['text-letter-spacing'] = ['case', isDistrict, districts.letterSpacing, layer.layout['text-letter-spacing'] ?? 0]
      layout['text-size'] = scaleStops(layout['text-size'], size => ['case', isDistrict, ['*', size, districts.scale], size])
    }
    return { ...layer, layout }
  })
}

/** Maps each output of a zoom `interpolate`, since a zoom curve cannot be nested inside arithmetic. */
function scaleStops(size: any, scale: (size: any) => any): any {
  if (!Array.isArray(size) || size[0] !== 'interpolate') return typeof size === 'number' ? scale(size) : size
  const [op, curve, input, ...stops] = size
  return [op, curve, input, ...stops.map((v, i) => (i % 2 ? scale(v) : v))]
}
