import mitt from 'mitt'
import type { MapEvents } from '@/types/map.types'

export const mapEventBus = mitt<MapEvents>()
