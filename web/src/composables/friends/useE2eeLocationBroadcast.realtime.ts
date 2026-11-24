import { useE2eeLocationBroadcast } from '@/composables/friends/useE2eeLocationBroadcast'
import { registerRealtimeHandlers } from '@/lib/realtime/realtime-events'

function reloadSharing() {
  void useE2eeLocationBroadcast().loadFriendsWithSharing()
}

registerRealtimeHandlers('location-broadcast', {
  'friendship:created': reloadSharing,
  'friendship:removed': reloadSharing,
  'realtime:reconnected': reloadSharing,
})
