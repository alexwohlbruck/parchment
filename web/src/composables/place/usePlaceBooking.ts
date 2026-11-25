import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Place } from '@/types/place.types'
import { bookingLinks, isDiningPlace, reservationPolicy } from '@/lib/place/place-booking'

export function usePlaceBooking(place: MaybeRefOrGetter<Partial<Place> | null | undefined>) {
  const tags = computed(() => toValue(place)?.tags ?? {})

  const links = computed(() => {
    const p = toValue(place)
    const address = p?.address?.value
    return bookingLinks({
      name: p?.name?.value ?? '',
      tags: tags.value,
      center: p?.geometry?.value?.center,
      locality: address?.locality,
      region: address?.region,
      countryCode: address?.countryCode,
    })
  })

  return {
    policy: computed(() => reservationPolicy(tags.value)),
    dining: computed(() => isDiningPlace(tags.value)),
    links,
  }
}
