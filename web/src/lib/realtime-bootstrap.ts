/**
 * Side-effect-only module that imports every store (or service) that
 * subscribes to realtime events. Importing this once at app start runs
 * each `registerRealtimeHandlers` call so events are routed to the
 * correct handlers the moment the socket opens.
 *
 * Stores themselves don't auto-register just by being imported elsewhere
 * (Pinia lazy-evaluates them on first `useXStore()` call). This file
 * forces-loads the ones that need the handler side effect.
 *
 * Kept separate from `realtime.ts` so the socket manager doesn't depend
 * on every store — the socket can be tested in isolation.
 */

import '@/stores/library/collections.realtime'
import '@/stores/library/bookmarks.realtime'
import '@/stores/friends.realtime'
