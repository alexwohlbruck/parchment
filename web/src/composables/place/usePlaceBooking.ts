import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Place } from '@/types/place.types'
import { bookingKind, bookingLinks, reservationPolicy } from '@/lib/place/place-booking'
import { addNights, tableTime, type BookingPlan } from '@/lib/place/place-stay'

export function usePlaceBooking(
  place: MaybeRefOrGetter<Partial<Place> | null | undefined>,
  plan?: MaybeRefOrGetter<BookingPlan | null>,
) {
  const tags = computed(() => toValue(place)?.tags ?? {})

  const links = computed(() => {
    const p = toValue(place)
    const address = p?.address?.value
    const chosen = toValue(plan)
    return bookingLinks({
      name: p?.name?.value ?? '',
      tags: tags.value,
      center: p?.geometry?.value?.center,
      locality: address?.locality,
      region: address?.region,
      countryCode: address?.countryCode,
      plan: chosen
        ? {
            party: chosen.party,
            day: chosen.day,
            checkout: addNights(chosen.day, chosen.nights),
            tableTime: tableTime(chosen.day),
          }
        : undefined,
    })
  })

  return {
    policy: computed(() => reservationPolicy(tags.value)),
    kind: computed(() => bookingKind(tags.value)),
    links,
  }
}
