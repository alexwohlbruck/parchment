import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

export const TRACKERS_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  {
    templateId: 'default:trackers-locations',
    name: 'Trackers',
    type: LayerType.TRACKERS,
    icon: 'TelescopeIcon',
    showInLayerSelector: true,
    visible: true,
    order: -1,
    groupId: null,
    isSubLayer: false,
    integrationId: null,
    configuration: {
      id: 'trackers-locations',
      type: 'circle',
      source: 'trackers-locations',
    },
  },
]
