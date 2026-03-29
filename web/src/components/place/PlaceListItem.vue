<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { getPlaceRoute, formatAddress } from '@/lib/place.utils'
import {
  getSearchResultIconName,
  getSearchResultIconPack,
  getSearchResultCategory,
  getSearchResultName,
} from '@/lib/search.utils'
import { getCategoryColor } from '@/lib/place-colors'
import { useThemeStore } from '@/stores/theme.store'
import { StarIcon, PhoneIcon, ClockIcon, MapPinIcon } from 'lucide-vue-next'
import type { Place } from '@/types/place.types'
import { Card, CardContent } from '@/components/ui/card'
import { ItemIcon } from '@/components/ui/item-icon'

const props = withDefaults(defineProps<{
  place: Place
  showIcon?: boolean
}>(), {
  showIcon: true,
})

const { t } = useI18n()
const router = useRouter()
const themeStore = useThemeStore()

const iconName = computed(() => getSearchResultIconName(props.place))
const iconPack = computed(() => getSearchResultIconPack(props.place))
const categoryColor = computed(() =>
  getCategoryColor(getSearchResultCategory(props.place), themeStore.isDark),
)
const displayName = computed(() => getSearchResultName(props.place))
const address = computed(() => formatAddress(props.place))

// True when the display name is the real OSM name (not the type/address fallback)
const hasRealName = computed(() => !!props.place.name?.value)

// Show the place type as a subtitle only when a real name exists and the type is meaningful
const placeType = computed(() => {
  const type = props.place.placeType?.value
  if (!type || type === 'place') return null
  const label = type.charAt(0).toUpperCase() + type.slice(1)
  // Suppress if name IS the type (already shown as title)
  return hasRealName.value ? label : null
})

// Only show the address when it adds info (differs from the display name)
const showAddress = computed(() =>
  !!address.value && address.value !== displayName.value,
)

const rating = computed(() =>
  props.place.ratings?.rating?.value
    ? props.place.ratings.rating.value * 5
    : null,
)
const reviewCount = computed(() => props.place.ratings?.reviewCount?.value || null)
const formattedRating = computed(() => rating.value?.toFixed(1) ?? null)
const phone = computed(() => props.place.contactInfo?.phone?.value || null)

// ── Tag-derived summary (generated server-side) ───────────────────────────────

const tagSummary = computed(() => (props.place as any).summary as string | null | undefined)

const hasDetails = computed(() =>
  !!(placeType.value || isOpen.value !== null || hoursText.value || showAddress.value || phone.value || tagSummary.value),
)

// Top-align icon only when content spans 3+ lines (address/phone/summary push it taller)
const hasMultilineDetails = computed(() =>
  !!(showAddress.value || phone.value || tagSummary.value ||
    (placeType.value && (isOpen.value !== null || hoursText.value))),
)

const isOpen = computed(() => {
  const hours = props.place.openingHours?.value
  if (!hours) return null
  if (hours.isPermanentlyClosed) return false
  if (hours.isTemporarilyClosed) return false
  if (hours.isOpen24_7) return true
  return null
})

const hoursText = computed(() => {
  const hours = props.place.openingHours?.value
  if (!hours) return null
  if (hours.isPermanentlyClosed) return t('place.hours.permanentlyClosed')
  if (hours.isTemporarilyClosed) return t('place.hours.temporarilyClosed')
  if (hours.isOpen24_7) return t('place.hours.open24hours')
  return null
})

function handleClick() {
  const route = getPlaceRoute(props.place.id)
  router.push(route)
}
</script>

<template>
  <Card class="cursor-pointer transition-colors hover:bg-muted/30" @click="handleClick">
    <CardContent class="px-2 py-2">
      <div class="flex gap-2" :class="hasMultilineDetails ? 'items-start' : 'items-center'">

        <!-- Left: category icon -->
        <ItemIcon
          v-if="showIcon"
          :icon="iconName"
          :icon-pack="iconPack"
          size="sm"
          :custom-color="categoryColor"
          variant="solid"
          shape="circle"
          :class="['shrink-0', hasMultilineDetails ? 'mt-0.5' : '']"
        />

        <!-- Right: all text content -->
        <div class="flex-1 min-w-0 flex flex-col gap-0.5">

          <!-- Name + rating inline -->
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-sm text-foreground leading-snug truncate">
              {{ displayName }}
            </span>
            <div v-if="formattedRating" class="flex items-center gap-1 shrink-0">
              <StarIcon class="w-3 h-3 text-yellow-500 fill-yellow-500" />
              <span class="text-xs font-medium text-foreground">{{ formattedRating }}</span>
              <span v-if="reviewCount" class="text-xs text-muted-foreground">({{ reviewCount.toLocaleString() }})</span>
            </div>
          </div>

          <!-- Type / hours row -->
          <div
            v-if="placeType || isOpen !== null || hoursText"
            class="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span v-if="placeType">{{ placeType }}</span>
            <span
              v-if="isOpen !== null || hoursText"
              class="flex items-center gap-1"
              :class="isOpen === true ? 'text-green-600' : isOpen === false ? 'text-red-500' : 'text-muted-foreground'"
            >
              <ClockIcon class="w-3 h-3 shrink-0" />
              <span v-if="isOpen === true">{{ t('place.listItem.openNow') }}</span>
              <span v-else-if="isOpen === false">{{ t('place.hours.closed') }}</span>
              <span v-if="hoursText">{{ hoursText }}</span>
            </span>
          </div>

          <!-- Tag summary (server-generated) -->
          <div
            v-if="tagSummary"
            class="text-xs text-muted-foreground leading-snug"
          >
            {{ tagSummary }}
          </div>

          <!-- Address -->
          <div v-if="showAddress" class="flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPinIcon class="w-3 h-3 shrink-0 mt-[1px]" />
            <span class="truncate">{{ address }}</span>
          </div>

          <!-- Phone -->
          <div v-if="phone" class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PhoneIcon class="w-3 h-3 shrink-0" />
            <span>{{ phone }}</span>
          </div>

        </div>
      </div>
    </CardContent>
  </Card>
</template>
