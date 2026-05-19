import { registerRealtimeHandlers } from '@/lib/realtime-events'
import { useSubscriptionService } from '@/services/subscription.service'

registerRealtimeHandlers('subscription', {
  'subscription:updated': () => {
    void useSubscriptionService().refreshStatus()
  },
  'realtime:reconnected': () => {
    void useSubscriptionService().refreshStatus()
  },
})
