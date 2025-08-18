<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { getPlaceRoute, formatAddress } from '@/lib/place.utils'
import { getSearchResultIcon, getSearchResultName } from '@/lib/search.utils'
import { StarIcon, PhoneIcon, ClockIcon, MapPinIcon } from 'lucide-vue-next'
import type { Place } from '@/types/place.types'

const props = defineProps<{
  place: Place
}>()

const router = useRouter()

const icon = computed(() => getSearchResultIcon(props.place))
const name = computed(() => getSearchResultName(props.place))
const address = computed(() => formatAddress(props.place))

const rating = computed(() => {
  return props.place.ratings?.rating?.value * 5 || null
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

const placeType = computed(() => {
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
  <div
    class="p-4 hover:bg-muted/50 cursor-pointer border-b border-border/50 last:border-b-0"
    @click="handleClick"
  >
    <!-- Business Name -->
    <div class="flex items-start gap-3">
      <div class="flex-shrink-0 w-6 h-6 mt-1 flex items-center justify-center">
        <component :is="icon" class="w-5 h-5 text-muted-foreground" />
      </div>

      <div class="flex-1 min-w-0">
        <h3 class="text-lg font-semibold text-foreground truncate">
          {{ name }}
        </h3>
      </div>
    </div>

    <!-- Rating, Reviews, Price -->
    <div v-if="rating || reviewCount" class="flex items-center gap-2 ml-9">
      <div class="flex items-center gap-1">
        <span class="text-sm font-medium">{{ formattedRating }}</span>
        <div class="flex">
          <StarIcon
            v-for="i in 5"
            :key="i"
            class="w-3 h-3"
            :class="
              i <= Math.round(rating || 0)
                ? 'text-yellow-400 fill-current'
                : 'text-gray-300'
            "
          />
        </div>
        <span v-if="reviewCount" class="text-sm text-muted-foreground">
          ({{ reviewCount.toLocaleString() }})
        </span>
      </div>
    </div>

    <!-- Category and Status -->
    <div class="flex items-center gap-2 ml-9">
      <span v-if="placeType" class="text-sm text-muted-foreground">
        {{ placeType }}
      </span>
      <span
        v-if="placeType && (isOpen !== null || hoursText)"
        class="text-muted-foreground"
        >•</span
      >
      <div v-if="isOpen !== null || hoursText" class="flex items-center gap-1">
        <ClockIcon class="w-3 h-3 text-muted-foreground" />
        <span
          class="text-sm"
          :class="
            isOpen === true
              ? 'text-green-600'
              : isOpen === false
              ? 'text-red-600'
              : 'text-muted-foreground'
          "
        >
          <span v-if="isOpen === true">Open</span>
          <span v-else-if="isOpen === false">Closed</span>
          <span v-if="hoursText"> • {{ hoursText }}</span>
        </span>
      </div>
    </div>

    <!-- Address -->
    <div v-if="place.address" class="flex items-start gap-2 ml-9">
      <MapPinIcon class="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
      <span class="text-sm text-muted-foreground">
        {{ place.address.value.formatted }}
      </span>
    </div>

    <!-- Phone -->
    <div v-if="phone" class="flex items-center gap-2 ml-9">
      <PhoneIcon class="w-3 h-3 text-muted-foreground" />
      <span class="text-sm text-muted-foreground">{{ phone }}</span>
    </div>
  </div>
</template>
