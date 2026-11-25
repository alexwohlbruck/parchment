<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BedDoubleIcon, CalendarCheckIcon, ExternalLinkIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import PlaceSection from './PlaceSection.vue'
import StayRoomList from './StayRoomList.vue'
import type { Place } from '@/types/place.types'
import { usePlaceBooking } from '@/composables/place/usePlaceBooking'
import { useStayRates } from '@/composables/place/useStayRates'
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
const { policy, kind, links } = usePlaceBooking(() => props.place, plan)

const isStay = computed(() => kind.value === 'stay')
const icon = computed(() => (isStay.value ? BedDoubleIcon : CalendarCheckIcon))

const stayQuery = computed(() => {
  const osmId = props.place.externalIds?.osm
  if (!isStay.value || !osmId) return null
  return {
    source: 'osm',
    id: osmId,
    checkin: plan.value.day,
    checkout: addNights(plan.value.day, plan.value.nights),
    adults: plan.value.party,
    ...guestMarket(locale.value),
  }
})
const { rates, loading } = useStayRates(stayQuery)

function dayLabel(day: string) {
  const key = kind.value && dayLabelKey(day, kind.value)
  if (key) return t(`place.booking.day.${key}`)
  return new Date(`${day}T12:00`).toLocaleDateString(locale.value, { weekday: 'short', month: 'short', day: 'numeric' })
}

const dayOptions = computed(() => upcomingDays().map((day) => ({ value: day, label: dayLabel(day) })))
const partyOptions = computed(() =>
  PARTY_SIZES.map((n) => ({ value: n, label: t(isStay.value ? 'place.booking.guests' : 'place.booking.party', { n }, n) })),
)
const nightOptions = computed(() => STAY_NIGHTS.map((n) => ({ value: n, label: t('place.booking.nights', { n }, n) })))

const pricing = computed(() => !!rates.value || loading.value)
</script>

<template>
  <PlaceSection v-if="kind && links.length">
    <template #main>
      <div class="flex gap-3 items-center">
        <component :is="icon" class="size-4 shrink-0 text-muted-foreground" />
        <div class="flex flex-col min-w-0">
          <span class="font-medium text-sm">{{ t(`place.booking.title.${kind}`) }}</span>
          <span v-if="policy" class="text-xs text-muted-foreground">{{ t(`place.booking.policy.${policy}`) }}</span>
        </div>
      </div>

      <div v-if="kind !== 'ahead'" class="flex flex-wrap gap-1.5 pl-7">
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

      <StayRoomList v-if="pricing" :rates="rates" :loading="loading" class="pl-7" />

      <div class="flex flex-wrap items-center gap-2 pl-7">
        <span v-if="pricing" class="text-xs text-muted-foreground">{{ t('place.booking.rooms.compare') }}</span>
        <Button
          v-for="link in links"
          :key="link.provider"
          as="a"
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
          :variant="pricing ? 'ghost' : 'outline'"
          size="sm"
          class="gap-1.5"
          :class="pricing && 'h-7 px-2 text-xs'"
        >
          {{ t(`place.booking.providers.${link.provider}`) }}
          <ExternalLinkIcon class="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    </template>
  </PlaceSection>
</template>
