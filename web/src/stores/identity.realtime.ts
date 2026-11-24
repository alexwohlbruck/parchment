import { useIdentityStore } from '@/stores/identity.store'
import { registerRealtimeHandlers } from '@/lib/realtime/realtime-events'

registerRealtimeHandlers('identity', {
  'realtime:reconnected': () => {
    void useIdentityStore().retryPendingRevocations()
  },
})
