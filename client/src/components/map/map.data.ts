import { Basemap } from '@/types/map.types'
import {
  Globe2Icon,
  BlendIcon,
  SatelliteIcon,
  BikeIcon,
  TramFrontIcon,
  CarIcon,
  MountainSnowIcon,
} from 'lucide-vue-next'

type Icon = typeof Globe2Icon

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
}

export const layers: {
  name: string
  icon: Icon
}[] = [
  {
    name: 'Cycling',
    icon: BikeIcon,
  },
  {
    name: 'Transit',
    icon: TramFrontIcon,
  },
  {
    name: 'Traffic',
    icon: CarIcon,
  },
  {
    name: 'Terrain',
    icon: MountainSnowIcon,
  },
]
