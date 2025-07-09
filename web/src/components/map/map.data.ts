import { Icon } from '@/types/app.types'
import { Basemap } from '@/types/map.types'
import { Globe2Icon, BlendIcon, SatelliteIcon, Building } from 'lucide-vue-next'

/**
 * TODO:
 * Temporary file to store map data including basemaps, data sources, layers, and styles.
 * This will be store in our database in the future.
 */

export const basemaps: {
  [key in Basemap]: {
    name: string
    icon: Icon
    url: string
  }
} = {
  standard: {
    name: 'Standard',
    icon: Globe2Icon,
    url: 'mapbox://styles/mapbox/standard-beta',
  },
  hybrid: {
    name: 'Hybrid',
    icon: BlendIcon,
    url: 'mapbox://styles/mapbox/satellite-streets-v11',
  },
  satellite: {
    name: 'Aerial',
    icon: SatelliteIcon,
    url: 'mapbox://styles/mapbox/satellite-v9',
  },
  'google-3d': {
    name: 'Google 3D',
    icon: Building,
    url: 'mapbox://styles/mapbox/satellite-v9', // Base satellite style for 3D tiles
  },
}
