import mitt from 'mitt'
import type { MapEvents } from '@/types/map.types'

// TODO: Make a composable that can automatically off events when the component is unmounted
export const mapEventBus = mitt<MapEvents>()
