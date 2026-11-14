import {
  BikeIcon,
  CarFrontIcon,
  CarTaxiFrontIcon,
  FootprintsIcon,
  ShuffleIcon,
  TrainIcon,
} from 'lucide-vue-next'
import type { SelectedMode } from '@/types/multimodal.types'

export const MODE_ICONS: Record<SelectedMode, typeof CarFrontIcon> = {
  multi: ShuffleIcon,
  walking: FootprintsIcon,
  biking: BikeIcon,
  transit: TrainIcon,
  driving: CarFrontIcon,
  rideshare: CarTaxiFrontIcon,
}
