import { computed, type Ref } from 'vue'
import { mangroveSubject } from '@server/lib/mangrove'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '@server/types/integration.types'
import { useAuthStore } from '@/stores/auth.store'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { useIdentityStore } from '@/stores/identity.store'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { SOURCE } from '@/lib/constants'
import type { Place } from '@/types/place.types'

/**
 * Whether the signed-in user can write a Mangrove review of an OSM place. The
 * signing key lives in encrypted personal storage, which needs the user's
 * identity on this device and library write access.
 */
export function useCanReviewPlace(place: Ref<Partial<Place> | null | undefined>) {
  const authStore = useAuthStore()
  const integrationsStore = useIntegrationsStore()
  const identityStore = useIdentityStore()
  const authService = useAuthService()

  const subject = computed(() => {
    const name = place.value?.name?.value
    const center = place.value?.geometry?.value?.center
    if (!name || !center) return null
    return mangroveSubject({ name, lat: center.lat, lng: center.lng })
  })

  const canReview = computed(
    () =>
      !!authStore.me &&
      identityStore.hasLocalIdentity &&
      authService.hasPermission(PermissionId.LIBRARY_WRITE) &&
      !!subject.value &&
      !!place.value?.externalIds?.[SOURCE.OSM] &&
      integrationsStore.isCapabilityActive(
        IntegrationId.MANGROVE,
        IntegrationCapabilityId.REVIEWS,
      ),
  )

  return { subject, canReview }
}
