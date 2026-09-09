import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

export const DAYNIGHT_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  {
    templateId: 'default:daynight-overlay',
    name: 'Day & Night',
    type: LayerType.CUSTOM,
    engine: ['mapbox', 'maplibre'],
    icon: 'SunMoonIcon',
    showInLayerSelector: false,
    visible: false,
    order: 0,
    groupId: 'default:group:daynight',
    isSubLayer: true,
    configuration: {
      id: 'daynight-overlay',
      type: 'raster',
      source: {
        id: 'daynight',
        type: 'image',
      },
      paint: {},
    },
  },
]
