import { BikeIcon, CarFrontIcon, FootprintsIcon } from 'lucide-vue-next'
import type { FreeMode } from '@/lib/guidance/free-roam'

export const FREE_MODE_ICONS: Record<FreeMode, typeof CarFrontIcon> = {
  driving: CarFrontIcon,
  cycling: BikeIcon,
  walking: FootprintsIcon,
}
