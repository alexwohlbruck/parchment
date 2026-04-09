import type { LayerGroup } from '@/types/map.types'
import { computed } from 'vue'

// Client-side layer groups (never persisted to database)
export const CLIENT_SIDE_LAYER_GROUP_TEMPLATES = computed(
  (): Omit<LayerGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] => [
    {
      name: 'Cycling',
      icon: 'BikeIcon',
      showInLayerSelector: true,
      visible: false,
      order: 0,
    },
    {
      name: 'Mapillary',
      icon: 'CameraIcon',
      showInLayerSelector: true,
      visible: false,
      order: 1,
    },
    {
      name: 'Transit',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      fadeBasemap: true,
      order: 2,
    },
  ],
)

// Database-persisted layer group templates that users can have
export const USER_LAYER_GROUP_TEMPLATES = computed(
  (): Omit<LayerGroup, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] => [
    {
      name: 'Loom Transit',
      icon: 'TrainIcon',
      showInLayerSelector: true,
      visible: false,
      order: 1,
    },
    {
      name: 'Terrain',
      icon: 'MountainSnowIcon',
      showInLayerSelector: true,
      visible: false,
      order: 3,
    },
  ],
)
