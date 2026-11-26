<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BedDoubleIcon, CalendarCheckIcon, ExternalLinkIcon, GlobeIcon, SearchIcon, ShoppingBagIcon } from 'lucide-vue-next'
import { Chip } from '@/components/ui/chip'
import PlaceSection from '../details/PlaceSection.vue'
import StayPrices from './StayPrices.vue'
import BookingRow from './BookingRow.vue'
import BookingRowSkeleton from './BookingRowSkeleton.vue'
import BookingLogo from './BookingLogo.vue'
import type { Place } from '@/types/place.types'
import { usePlaceBooking } from '@/composables/place/usePlaceBooking'
import { useBookingData } from '@/composables/place/useBookingData'
import { fetchStayOffers } from '@/services/place/booking.service'
import type { BookingLink } from '@/lib/place/place-booking'
import { bookingBrandOf, isBookingBrand, siteName } from '@/lib/place/booking-brands'
import {
  PARTY_SIZES,
  STAY_NIGHTS,
  addNights,
  dayLabelKey,
  defaultPlan,
  guestMarket,
  upcomingDays,
} from '@/lib/place/place-stay'

const props = defineProps<{
  place: Partial<Place>
}>()

const { t, locale } = useI18n()
const plan = ref(defaultPlan())
const { policy, kind, placeId, links, loading: venuesLoading, delivery, googleHotelsUrl } = usePlaceBooking(
  () => props.place,
  plan,
)

const isStay = computed(() => kind.value === 'stay')
const icon = computed(() => (!kind.value ? ShoppingBagIcon : isStay.value ? BedDoubleIcon : CalendarCheckIcon))

const stayQuery = computed(() =>
  isStay.value && placeId.value
    ? {
        id: placeId.value,
        checkin: plan.value.day,
        checkout: addNights(plan.value.day, plan.value.nights),
        adults: plan.value.party,
        ...guestMarket(locale.value),
      }
    : null,
)
const { data: offers, loading: offersLoading } = useBookingData(stayQuery, fetchStayOffers)
/** Sellers already have priced rows, so the links below would only repeat them. */
const priced = computed(() => !!offers.value?.offers.length)
const comparing = computed(() => priced.value || offersLoading.value)

function linkLabel(link: BookingLink) {
  if (link.provider === 'search') return t('place.booking.searchWeb')
  const site = link.name ?? t(`place.booking.providers.${link.provider}`)
  return link.search ? t('place.booking.searchOn', { site }) : site
}

const linkBrand = (link: BookingLink) =>
  isBookingBrand(link.provider) ? link.provider : link.provider === 'other' ? bookingBrandOf(link.url) : null

const linkIcon = (link: BookingLink) =>
  link.provider === 'venue' ? GlobeIcon : link.provider === 'search' ? SearchIcon : undefined

function whenLabel(day: string) {
  const key = kind.value && dayLabelKey(day, kind.value)
  if (key) return t(`place.booking.when.${key}`)
  return t('place.booking.when.date', { date: dateLabel(day) })
}

/** What the page shows: a booking site opens prefilled, anyone else's site just opens. */
const planHint = computed(() => {
  const { day, party, nights } = plan.value
  if (kind.value === 'table') return t('place.booking.seeTimes', { party: partyOptions.value[party - 1]?.label, when: whenLabel(day) })
  if (kind.value === 'stay')
    return t('place.booking.seeRooms', {
      guests: partyOptions.value[party - 1]?.label,
      nights: t('place.booking.nights', { n: nights }, nights),
    })
  return null
})

function linkHint(link: BookingLink) {
  if (link.search) return null
  if (link.provider === 'venue' || (link.provider === 'other' && !linkBrand(link))) return siteName(link.url)
  return planHint.value
}

/** Searches sit quieter than a venue's own pages, and never beside them. */
const searching = computed(() => links.value.some((link) => link.search))

/** "Takes reservations" only repeats the title; a stronger policy is worth saying. */
const subtitle = computed(() => {
  if (comparing.value) return t('place.booking.offers.subtitle')
  return policy.value && policy.value !== 'yes' && !isStay.value ? t(`place.booking.policy.${policy.value}`) : null
})

const title = computed(() => {
  if (comparing.value) return t('place.booking.offers.title')
  return kind.value ? t(`place.booking.title.${kind.value}`) : t('place.booking.delivery')
})

const dateLabel = (day: string) =>
  new Date(`${day}T12:00`).toLocaleDateString(locale.value, { weekday: 'short', month: 'short', day: 'numeric' })

function dayLabel(day: string) {
  const key = kind.value && dayLabelKey(day, kind.value)
  return key ? t(`place.booking.day.${key}`) : dateLabel(day)
}

const dayOptions = computed(() => upcomingDays().map((day) => ({ value: day, label: dayLabel(day) })))
const partyOptions = computed(() =>
  PARTY_SIZES.map((n) => ({ value: n, label: t(isStay.value ? 'place.booking.guests' : 'place.booking.party', { n }, n) })),
)
const nightOptions = computed(() => STAY_NIGHTS.map((n) => ({ value: n, label: t('place.booking.nights', { n }, n) })))
</script>

<template>
  <PlaceSection v-if="(kind && links.length) || delivery.length" data-testid="place-booking">
    <template #main>
      <div class="flex gap-3 items-center">
        <component :is="icon" class="size-4 shrink-0 text-muted-foreground" />
        <div class="flex flex-col min-w-0">
          <span class="font-medium text-sm">{{ title }}</span>
          <span v-if="subtitle" class="text-xs text-muted-foreground">{{ subtitle }}</span>
        </div>
      </div>

      <div v-if="kind !== 'ahead' && links.length" class="flex flex-wrap gap-1.5 pl-7">
        <Chip
          variant="dropdown"
          :label="dayLabel(plan.day)"
          :options="dayOptions"
          :dropdown-value="plan.day"
          :show-clear="false"
          @update:dropdown-value="(v) => (plan = { ...plan, day: String(v) })"
        />
        <Chip
          v-if="isStay"
          variant="dropdown"
          :label="t('place.booking.nights', { n: plan.nights }, plan.nights)"
          :options="nightOptions"
          :dropdown-value="plan.nights"
          :show-clear="false"
          @update:dropdown-value="(v) => (plan = { ...plan, nights: Number(v) })"
        />
        <Chip
          variant="dropdown"
          :label="partyOptions[plan.party - 1]?.label ?? ''"
          :options="partyOptions"
          :dropdown-value="plan.party"
          :show-clear="false"
          @update:dropdown-value="(v) => (plan = { ...plan, party: Number(v) })"
        />
      </div>

      <StayPrices v-if="comparing" :offers="offers" :loading="offersLoading" :nights="plan.nights" class="pl-7" />

      <a
        v-if="priced"
        :href="googleHotelsUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="ml-7 inline-flex items-center gap-1.5 self-start text-xs font-medium text-primary hover:underline"
      >
        {{ t('place.booking.offers.moreOnGoogleHotels') }}
        <ExternalLinkIcon class="size-3" />
      </a>

      <div v-else-if="!comparing && (venuesLoading || links.length || delivery.length)" class="flex flex-col pl-7">
        <template v-if="venuesLoading">
          <BookingRowSkeleton v-for="n in 2" :key="n" data-testid="booking-links-skeleton" />
        </template>
        <template v-else-if="kind && links.length">
          <span v-if="searching" class="pb-1 text-xs text-muted-foreground">{{ t('place.booking.notLinked') }}</span>
          <BookingRow
            v-for="link in links"
            :key="link.provider + (link.name ?? '')"
            :href="link.url"
            data-testid="booking-link"
          >
            <template #logo>
              <BookingLogo :brand="linkBrand(link)" :icon="linkIcon(link)" :name="linkLabel(link)" />
            </template>
            {{ linkLabel(link) }}
            <template v-if="linkHint(link)" #detail>{{ linkHint(link) }}</template>
          </BookingRow>
        </template>

        <template v-if="delivery.length">
          <span v-if="kind && links.length" class="pt-2 pb-1 text-xs text-muted-foreground">
            {{ t('place.booking.delivery') }}
          </span>
          <BookingRow v-for="link in delivery" :key="link.name" :href="link.url" data-testid="delivery-link">
            <template #logo><BookingLogo :brand="link.brand" :name="link.name" /></template>
            {{ link.name }}
          </BookingRow>
        </template>
      </div>
    </template>
  </PlaceSection>
</template>
