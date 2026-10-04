import { computed, type Ref } from 'vue'
import { mangroveSubject } from '@server/lib/mangrove'
import {
  IntegrationCapabilityId,
  IntegrationId,
} from '@server/types/integration.types'
import { useIntegrationsStore } from '@/stores/integrations.store'
import { SOURCE } from '@/lib/constants'
import type { Place } from '@/types/place.types'

/** Whether an OSM place can be reviewed through Mangrove's signer. */
export function useCanReviewPlace(place: Ref<Partial<Place> | null | undefined>) {
  const integrationsStore = useIntegrationsStore()

  const subject = computed(() => {
    const name = place.value?.name?.value
    const center = place.value?.geometry?.value?.center
    if (!name || !center) return null
    return mangroveSubject({ name, lat: center.lat, lng: center.lng })
  })

  const signerClientId = computed(
    () =>
      integrationsStore.getIntegrationConfigValue(
        IntegrationId.MANGROVE,
        'signerClientId',
      ) as string | undefined,
  )

  const canReview = computed(
    () =>
      !!subject.value &&
      !!signerClientId.value &&
      !!place.value?.externalIds?.[SOURCE.OSM] &&
      integrationsStore.isCapabilityActive(
        IntegrationId.MANGROVE,
        IntegrationCapabilityId.REVIEWS,
      ),
  )

  return { subject, signerClientId, canReview }
}
