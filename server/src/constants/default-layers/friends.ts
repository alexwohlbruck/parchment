import { DefaultLayerTemplate } from '../../types/layers.types'

export const FRIENDS_LAYER_TEMPLATES: DefaultLayerTemplate[] = [
  {
    templateId: 'default:friends-locations',
    name: 'Friends',
    type: 'friends',
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
