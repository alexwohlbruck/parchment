import type { Typography } from './themes'

const GEIST = 'Geist '

/** Every label in the theme's family at Geist's weights, and its road names cased and spaced its way. */
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
    return { ...layer, layout }
  })
}

const ROAD_LABELS = 'Road labels'
