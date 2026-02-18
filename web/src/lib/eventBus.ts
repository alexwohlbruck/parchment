import mitt, { type Emitter } from 'mitt'
import type { MapEvents } from '@/types/map.types'
import type { AppEvents } from '@/types/app.types'

type EventBusHandler<T> = (data: T) => void

/**
 * Enhanced event bus with override support
 * Override handlers prevent other handlers from firing until they're removed
 * Multiple overrides are supported - most recent takes priority
 */
function createEventBus<Events extends Record<string, any>>() {
  const emitter = mitt<Events>()
  const overrideHandlers = new Map<keyof Events, EventBusHandler<any>[]>()

  return {
    on<K extends keyof Events>(event: K, handler: EventBusHandler<Events[K]>) {
      emitter.on(event, handler)
    },

    off<K extends keyof Events>(event: K, handler: EventBusHandler<Events[K]>) {
      // Remove from override tracking
      const overrides = overrideHandlers.get(event)
      if (overrides) {
        const index = overrides.indexOf(handler)
        if (index !== -1) {
          overrides.splice(index, 1)
          if (overrides.length === 0) {
            overrideHandlers.delete(event)
          }
        }
      }
      emitter.off(event, handler)
    },

    emit<K extends keyof Events>(event: K, data: Events[K]) {
      const overrides = overrideHandlers.get(event)
      if (overrides && overrides.length > 0) {
        // Call most recent override only
        overrides[overrides.length - 1](data)
      } else {
        emitter.emit(event, data)
      }
    },

    setOverride<K extends keyof Events>(event: K, handler: EventBusHandler<Events[K]>) {
      if (!overrideHandlers.has(event)) {
        overrideHandlers.set(event, [])
      }
      overrideHandlers.get(event)!.push(handler)
    },

    all: emitter.all,
  } as Emitter<Events> & {
    setOverride<K extends keyof Events>(event: K, handler: EventBusHandler<Events[K]>): void
  }
}

export const mapEventBus = createEventBus<MapEvents>()
export const appEventBus = createEventBus<AppEvents>()
