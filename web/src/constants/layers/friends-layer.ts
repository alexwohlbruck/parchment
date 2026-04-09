import {
  LayerType,
  MapEngine,
  MapboxLayerType,
} from '@/types/map.types'
import type { Layer } from '@/types/map.types'

// Friends location layer (uses Vue markers instead of map layers)
export const FRIENDS_LAYER: Omit<
  Layer,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
> = {
  name: 'Friends',
  icon: 'UsersIcon',
  showInLayerSelector: true,
  visible: true,
  type: LayerType.FRIENDS,
  engine: [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
  groupId: null,
  order: -1,
  configuration: {
    id: 'friends-locations',
    type: MapboxLayerType.CIRCLE,
    source: 'friends-locations',
  },
}
