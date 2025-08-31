<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { getPlaceRoute, formatAddress } from '@/lib/place.utils'
import {
  getSearchResultIconName,
  getSearchResultName,
} from '@/lib/search.utils'
import { StarIcon, PhoneIcon, ClockIcon, MapPinIcon } from 'lucide-vue-next'
import type { Place } from '@/types/place.types'
import { H3, H4, H5, H6, P, Caption } from '@/components/ui/typography'
import { Card, CardContent } from '@/components/ui/card'
import { ItemIcon } from '@/components/ui/item-icon'

const props = defineProps<{
  place: Place
}>()

const router = useRouter()

const iconName = computed(() => getSearchResultIconName(props.place))
const name = computed(() => getSearchResultName(props.place))
const address = computed(() => formatAddress(props.place))

// Check if we're showing place type as the name (because no actual name exists)
const isUsingPlaceTypeAsName = computed(() => {
  return !props.place.name.value
})

const rating = computed(() => {
  return props.place.ratings?.rating?.value
    ? props.place.ratings.rating.value * 5
    : null
})

const reviewCount = computed(() => {
  return props.place.ratings?.reviewCount?.value || null
})

const formattedRating = computed(() => {
  if (!rating.value) return null
  return rating.value.toFixed(1)
})

const phone = computed(() => {
  return props.place.contactInfo?.phone?.value || null
})

// Only show place type if we have a real name (not using place type as name)
const placeType = computed(() => {
  if (isUsingPlaceTypeAsName.value) return null
  const type = props.place.placeType?.value
  if (!type || type === 'place') return null
  return type.charAt(0).toUpperCase() + type.slice(1)
})

const isOpen = computed(() => {
  const hours = props.place.openingHours?.value
  if (!hours) return null

  if (hours.isPermanentlyClosed) return false
  if (hours.isTemporarilyClosed) return false
  if (hours.isOpen24_7) return true

  // For now, return null if we can't determine status
  // TODO: Implement proper time-based open/closed logic
  return null
})

const hoursText = computed(() => {
  const hours = props.place.openingHours?.value
  if (!hours) return null

  if (hours.isPermanentlyClosed) return 'Permanently closed'
  if (hours.isTemporarilyClosed) return 'Temporarily closed'
  if (hours.isOpen24_7) return 'Open 24 hours'

  // TODO: Calculate actual closing time based on current time and schedule
  return null
})

function handleClick() {
  const route = getPlaceRoute(props.place.id)
  router.push(route)
}
</script>

<template>
  <Card class="cursor-pointer" @click="handleClick">
    <CardContent class="p-2">
      <!-- Main Content -->
      <div class="space-y-3">
        <!-- Header with icon and name -->
        <div class="flex items-center gap-3">
          <ItemIcon
            :icon="iconName"
            size="md"
            color="primary"
            variant="ghost"
          />

          <div class="flex-1 flex flex-col">
            <H6 class="truncate font-medium">
              {{ name }}
            </H6>

            <!-- Place type badge -->
            <div v-if="placeType" class="inline-flex">
              <Caption class="text-xs font-medium text-muted-foreground">
                {{ placeType }}
              </Caption>
            </div>
          </div>
        </div>

        <!-- Rating and Reviews -->
        <div v-if="rating || reviewCount" class="flex items-center gap-2">
          <div class="flex items-center gap-1.5">
            <div class="flex items-center gap-1">
              <span class="text-sm font-semibold text-foreground">{{
                formattedRating
              }}</span>
              <div class="flex gap-0.5">
                <StarIcon
                  v-for="i in 5"
                  :key="i"
                  class="w-3 h-3"
                  :class="
                    i <= Math.round(rating || 0)
                      ? 'text-yellow-500 fill-yellow-500'
                      : 'text-muted-foreground/30'
                  "
                />
              </div>
            </div>
            <span v-if="reviewCount" class="text-xs text-muted-foreground">
              {{ reviewCount.toLocaleString() }} reviews
            </span>
          </div>
        </div>

        <!-- Status and Hours -->
        <div
          v-if="isOpen !== null || hoursText"
          class="flex items-center gap-1.5"
        >
          <div class="flex items-center gap-1">
            <ClockIcon class="w-3.5 h-3.5 text-muted-foreground" />
            <span
              class="text-xs font-medium"
              :class="
                isOpen === true
                  ? 'text-green-600'
                  : isOpen === false
                  ? 'text-red-600'
                  : 'text-muted-foreground'
              "
            >
              <span v-if="isOpen === true">Open now</span>
              <span v-else-if="isOpen === false">Closed</span>
              <span v-if="hoursText">{{ hoursText }}</span>
            </span>
          </div>
        </div>

        <!-- Address -->
        <div v-if="address" class="flex items-start gap-1.5 ml-13">
          <MapPinIcon
            class="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0"
          />
          <span class="text-xs text-muted-foreground leading-relaxed">
            {{ address }}
          </span>
        </div>

        <!-- Phone -->
        <div v-if="phone" class="flex items-center gap-1.5 ml-13">
          <PhoneIcon class="w-3.5 h-3.5 text-muted-foreground" />
          <span class="text-xs text-muted-foreground">{{ phone }}</span>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
