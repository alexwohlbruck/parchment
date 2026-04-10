import { DefaultLayerTemplate } from '../../types/layers.types'
import { LayerType } from '../../schema/layers.schema'

export const FRIENDS_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  {
    templateId: 'default:friends-locations',
    name: 'Friends',
    type: LayerType.FRIENDS,
    icon: 'UsersIcon',
    showInLayerSelector: true,
    visible: true,
    order: -1,
    groupId: null,
    isSubLayer: false,
    integrationId: null,
    configuration: {
      id: 'friends-locations',
      type: 'circle',
      source: 'friends-locations',
    },
  },
]
