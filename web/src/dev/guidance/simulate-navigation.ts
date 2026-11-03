import { useStorage } from '@vueuse/core'

/** When on, every navigation drives its route with simulated GPS from the start. */
export const simulateNavigation = useStorage('dev-simulate-navigation', false)
