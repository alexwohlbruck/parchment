import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { Place } from '@/types/place.types'
import {
  bookingLinks,
  deliveryLinks,
  googleHotelsSearchUrl,
  type BookingTarget,
  effectiveBookingKind,
  isDiningPlace,
  isLodgingPlace,
  reservationPolicy,
} from '@/lib/place/place-booking'
import { addNights, tableTime, type BookingPlan } from '@/lib/place/place-stay'
import { listingPlaceId } from '@/lib/place/listing-providers'
import { fetchBookingVenues } from '@/services/place/booking.service'
import { useBookingData } from './useBookingData'

export function usePlaceBooking(
  place: MaybeRefOrGetter<Partial<Place> | null | undefined>,
  plan?: MaybeRefOrGetter<BookingPlan | null>,
) {
  const tags = computed(() => toValue(place)?.tags ?? {})
  const placeId = computed(() => listingPlaceId(toValue(place)?.externalIds))
  const actions = computed(() => toValue(place)?.placeActions?.value ?? undefined)

  const { data: venues } = useBookingData(
    () => ((isDiningPlace(tags.value) || isLodgingPlace(tags.value)) && placeId.value) || null,
    fetchBookingVenues,
  )
  const knownElsewhere = computed(
    () =>
      Object.keys(venues.value?.venues ?? {}).length > 0 ||
      (actions.value ?? []).some(a => a.kind === 'reservation'),
  )
  const kind = computed(() => effectiveBookingKind(tags.value, knownElsewhere.value))

  const target = computed((): BookingTarget => {
    const p = toValue(place)
    const address = p?.address?.value
    const chosen = toValue(plan)
    return {
      name: p?.name?.value ?? '',
      tags: tags.value,
      kind: kind.value,
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
    }
  })
  const links = computed(() => bookingLinks(target.value))

  return {
    policy: computed(() => reservationPolicy(tags.value)),
    kind,
    placeId,
    links,
    delivery: computed(() => deliveryLinks(actions.value)),
    googleHotelsUrl: computed(() => googleHotelsSearchUrl(target.value)),
  }
}
