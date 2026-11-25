<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BedDoubleIcon, ChevronRightIcon, ShieldCheckIcon } from 'lucide-vue-next'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import type { StayMoney, StayOffer, StayOffers } from '@server/types/integration.types'
import { groupOffers } from '@/lib/place/place-stay'
import { APP_NAME_SHORT } from '@/lib/constants'

const props = defineProps<{
  offers: StayOffers | null
  loading: boolean
}>()

const { t, locale } = useI18n()
const freeCancellationOnly = ref(false)
const expanded = ref(false)
const brokenLogos = ref(new Set<string>())
watch(() => props.offers, () => (expanded.value = false))

const groups = computed(() => groupOffers(props.offers?.offers ?? [], freeCancellationOnly.value, expanded.value))
const empty = computed(() => !groups.value.featured.length && !groups.value.others.length)

function money({ amount, currency }: StayMoney) {
  return new Intl.NumberFormat(locale.value, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

/** Short markers under a seller, each its own chip so none gets cut off. */
function markers(offer: StayOffer): { key: string; label: string; icon?: typeof ShieldCheckIcon; tone: string }[] {
  return [
    offer.bookHere && { key: 'app', label: t('place.booking.offers.inApp'), tone: 'text-primary border-primary/30' },
    offer.official && { key: 'official', label: t('place.booking.offers.official'), icon: ShieldCheckIcon, tone: 'text-muted-foreground' },
    offer.freeCancellation && {
      key: 'free',
      label: t('place.booking.offers.freeCancellation'),
      tone: 'text-forest-700 border-forest-300 dark:text-forest-300 dark:border-forest-800',
    },
  ].filter((m): m is Exclude<typeof m, false | undefined> => !!m)
}

const sellerName = (offer: StayOffer) => (offer.bookHere ? APP_NAME_SHORT : offer.seller)
</script>

<template>
  <div class="flex flex-col">
    <label class="flex items-center justify-between gap-3 py-1.5 text-xs text-muted-foreground">
      {{ t('place.booking.offers.freeCancellationOnly') }}
      <Switch v-model="freeCancellationOnly" class="scale-75 origin-right" />
    </label>

    <template v-if="loading">
      <div v-for="n in 3" :key="n" class="flex items-center gap-3 py-2.5">
        <Skeleton class="size-5 rounded" />
        <div class="flex flex-col gap-1.5 flex-1">
          <Skeleton class="h-4 w-1/2" />
          <Skeleton class="h-3 w-1/3" />
        </div>
        <Skeleton class="h-4 w-10" />
      </div>
    </template>

    <p v-else-if="empty" class="py-2 text-sm text-muted-foreground">
      {{ t(freeCancellationOnly ? 'place.booking.offers.noneFree' : 'place.booking.offers.none') }}
    </p>

    <template v-else>
      <template v-for="(group, g) in [groups.featured, groups.others]" :key="g">
        <span v-if="g === 1 && group.length && groups.featured.length" class="pt-3 pb-1 text-xs text-muted-foreground">
          {{ t('place.booking.offers.allOptions') }}
        </span>
        <a
          v-for="offer in group"
          :key="offer.seller"
          :href="offer.url"
          target="_blank"
          rel="noopener noreferrer"
          class="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
          data-testid="stay-offer"
        >
          <span
            v-if="offer.bookHere"
            class="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-primary"
          ><BedDoubleIcon class="size-3.5" /></span>
          <img
            v-else-if="offer.logo && !brokenLogos.has(offer.logo)"
            :src="offer.logo"
            alt=""
            referrerpolicy="no-referrer"
            loading="lazy"
            class="size-5 shrink-0 rounded object-contain"
            @error="brokenLogos = new Set(brokenLogos).add(offer.logo!)"
          />
          <span
            v-else
            class="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-medium text-muted-foreground"
          >{{ offer.seller.charAt(0) }}</span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-sm font-medium leading-snug break-words">{{ sellerName(offer) }}</span>
            <span v-if="offer.total" class="text-xs text-muted-foreground">
              {{ t('place.booking.offers.withTaxes', { price: money(offer.total) }) }}
            </span>
            <div v-if="markers(offer).length" class="flex flex-wrap gap-1 pt-0.5">
              <span
                v-for="marker in markers(offer)"
                :key="marker.key"
                class="inline-flex items-center gap-0.5 rounded-full border px-1.5 text-[10px] leading-4"
                :class="marker.tone"
              >
                <component :is="marker.icon" v-if="marker.icon" class="size-3" />
                {{ marker.label }}
              </span>
            </div>
          </div>
          <span class="text-sm font-semibold tabular-nums">
            {{ offer.nightly ? money(offer.nightly) : t('place.booking.offers.seePrice') }}
          </span>
          <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" />
        </a>
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
