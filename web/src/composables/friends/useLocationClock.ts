import { createSharedComposable, useNow } from '@vueuse/core'

/** One ticking clock for every "is this location stale?" check. */
export const useLocationClock = createSharedComposable(() =>
  useNow({ interval: 30_000 }),
)
