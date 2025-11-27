import mitt from 'mitt'
import type { MapEvents } from '@/types/map.types'
import type { AppEvents } from '@/types/app.types'

// TODO: Make a composable that can automatically off events when the component is unmounted
export const mapEventBus = mitt<MapEvents>()
export const appEventBus = mitt<AppEvents>()
