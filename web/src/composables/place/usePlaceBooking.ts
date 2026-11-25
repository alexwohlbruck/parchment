import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Place } from '@/types/place.types'
import { bookingKind, bookingLinks, deliveryLinks, reservationPolicy } from '@/lib/place/place-booking'
import { addNights, tableTime, type BookingPlan } from '@/lib/place/place-stay'
import { listingPlaceId } from '@/lib/place/listing-providers'
import { fetchBookingVenues } from '@/services/place/booking.service'
import { useBookingData } from './useBookingData'

export function usePlaceBooking(
  place: MaybeRefOrGetter<Partial<Place> | null | undefined>,
  plan?: MaybeRefOrGetter<BookingPlan | null>,
) {
  const tags = computed(() => toValue(place)?.tags ?? {})
  const kind = computed(() => bookingKind(tags.value))
  const placeId = computed(() => listingPlaceId(toValue(place)?.externalIds))
  const actions = computed(() => toValue(place)?.placeActions?.value ?? undefined)

  const { data: venues } = useBookingData(
    () => (kind.value && kind.value !== 'ahead' && placeId.value) || null,
    fetchBookingVenues,
  )

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
      venues: venues.value?.venues,
      unlisted: venues.value?.unlisted,
      actions: actions.value,
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
    kind,
    placeId,
    links,
    delivery: computed(() => deliveryLinks(actions.value)),
  }
}
