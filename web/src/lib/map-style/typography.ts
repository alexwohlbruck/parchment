import type { Typography } from './themes'
import { NEIGHBOURHOOD_LAYER } from './neighbourhood-labels'

const GEIST = 'Geist '
const ROAD_LABELS = 'Road labels'
const PLACE_LABELS = 'Place labels'
const DISTRICTS = ['suburb', 'neighborhood', 'neighbourhood', 'quarter']

/** Every label in the theme's family at Geist's weights, with its road and district names set its way. */
export function withTypography(layers: any[], typography: Typography | undefined): any[] {
  if (!typography) return layers
  const swap = (font: any): any =>
    typeof font === 'string' && font.startsWith(GEIST) ? `${typography.family} ${font.slice(GEIST.length)}`
      : Array.isArray(font) ? font.map(swap) : font
  return layers.map(layer => {
    const font = layer.layout?.['text-font']
    if (!font) return layer
    const layout = { ...layer.layout, 'text-font': swap(font) }
    if (layer.id === ROAD_LABELS && typography.roadLabels) {
      layout['text-transform'] = typography.roadLabels.transform
      layout['text-letter-spacing'] = typography.roadLabels.letterSpacing
    }
    const districts = typography.districtLabels
    if (districts && layer.id === NEIGHBOURHOOD_LAYER) {
      layout['text-font'] = ['literal', [districts.font]]
      layout['text-letter-spacing'] = districts.letterSpacing
    }
    if (districts && layer.id === PLACE_LABELS) {
      const isDistrict = ['in', ['get', 'class'], ['literal', DISTRICTS]]
      layout['text-font'] = ['case', isDistrict, ['literal', [districts.font]], ['literal', layout['text-font']]]
      layout['text-letter-spacing'] = ['case', isDistrict, districts.letterSpacing, layer.layout['text-letter-spacing'] ?? 0]
    }
    return { ...layer, layout }
  })
}
