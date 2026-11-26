<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BedDoubleIcon } from 'lucide-vue-next'
import { Switch } from '@/components/ui/switch'
import type { StayMoney, StayOffer, StayOffers } from '@server/types/integration.types'
import { groupOffers, nightlyPrice } from '@/lib/place/place-stay'
import { APP_NAME_SHORT } from '@/lib/constants'
import BookingRow from './BookingRow.vue'
import BookingRowSkeleton from './BookingRowSkeleton.vue'
import BookingLogo from './BookingLogo.vue'

const props = defineProps<{
  offers: StayOffers | null
  loading: boolean
  nights: number
}>()

const { t, locale } = useI18n()
const freeCancellationOnly = ref(false)
const expanded = ref(false)
watch(() => props.offers, () => (expanded.value = false))

const groups = computed(() => groupOffers(props.offers?.offers ?? [], props.nights, freeCancellationOnly.value, expanded.value))
const empty = computed(() => !groups.value.featured.length && !groups.value.others.length)

function money({ amount, currency }: StayMoney) {
  return new Intl.NumberFormat(locale.value, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

/** Short notes under a seller's name; only the in-app and free-cancellation ones are coloured. */
function markers(offer: StayOffer): { key: string; label: string; tone?: string }[] {
  return [
    offer.bookHere && { key: 'app', label: t('place.booking.offers.inApp'), tone: 'text-primary' },
    offer.official && { key: 'official', label: t('place.booking.offers.official') },
    offer.freeCancellation && {
      key: 'free',
      label: t('place.booking.offers.freeCancellation'),
      tone: 'text-forest-700 dark:text-forest-400',
    },
  ].filter((m): m is Exclude<typeof m, false | undefined> => !!m)
}

function price(offer: StayOffer) {
  const nightly = nightlyPrice(offer, props.nights)
  return nightly ? money(nightly) : t('place.booking.offers.seePrice')
}

const sellerName = (offer: StayOffer) => (offer.bookHere ? APP_NAME_SHORT : offer.seller)
</script>

<template>
  <div class="flex flex-col">
    <label class="flex h-9 items-center justify-between gap-3 text-xs text-muted-foreground">
      {{ t('place.booking.offers.freeCancellationOnly') }}
      <Switch v-model="freeCancellationOnly" />
    </label>

    <template v-if="loading">
      <BookingRowSkeleton v-for="n in 3" :key="n" priced data-testid="stay-offer-skeleton" />
    </template>

    <p v-else-if="empty" class="py-2 text-sm text-muted-foreground">
      {{ t('place.booking.offers.noneFree') }}
    </p>

    <template v-else>
      <template v-for="(group, g) in [groups.featured, groups.others]" :key="g">
        <span v-if="g === 1 && group.length && groups.featured.length" class="pt-2 pb-1 text-xs text-muted-foreground">
          {{ t('place.booking.offers.allOptions') }}
        </span>
        <BookingRow v-for="offer in group" :key="offer.seller" :href="offer.url" data-testid="stay-offer">
          <template #logo>
            <BookingLogo
              :icon="offer.bookHere ? BedDoubleIcon : undefined"
              :tone="offer.bookHere ? 'primary' : undefined"
              :src="offer.bookHere ? null : offer.logo"
              :name="offer.seller"
            />
          </template>
          {{ sellerName(offer) }}
          <template v-if="markers(offer).length" #detail>
            <template v-for="(marker, i) in markers(offer)" :key="marker.key">
              <template v-if="i"> · </template><span class="whitespace-nowrap" :class="marker.tone">{{ marker.label }}</span>
            </template>
          </template>
          <template #end>
            <span class="text-sm font-semibold tabular-nums">{{ price(offer) }}</span>
          </template>
        </BookingRow>
      </template>

      <button
        v-if="groups.hidden"
        type="button"
        class="self-start py-1.5 text-xs font-medium text-primary hover:underline"
        @click="expanded = true"
      >
        {{
          groups.hiddenFrom
            ? t('place.booking.offers.morePricesFrom', { price: money(groups.hiddenFrom) })
            : t('place.booking.offers.morePrices', { n: groups.hidden })
        }}
      </button>
    </template>
  </div>
</template>
