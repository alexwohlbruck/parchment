<script setup lang="ts">
import {
  PhoneIcon,
  GlobeIcon,
  MapPinIcon,
  UtensilsCrossedIcon,
  WifiIcon,
  TreesIcon,
  AccessibilityIcon,
  CigaretteIcon,
  ToiletIcon,
  MailIcon,
  LinkIcon,
  MapIcon,
  PlusIcon,
} from 'lucide-vue-next'
import DetailItem from './DetailItem.vue'
import PlaceHours from './PlaceHours.vue'
import type { UnifiedPlace } from '@/types/unified-place.types'
import { computed } from 'vue'
import { getWifiStatus, parseCuisines } from '@/lib/place.utils'
import { SOURCE } from '@/lib/constants'
import { encode } from 'pluscodes'

const props = defineProps<{
  place: UnifiedPlace
}>()

const cuisines = computed(() => {
  if (!props.place) return null
  const amenity = props.place.amenities?.cuisine?.[0]?.value as string
  return amenity ? parseCuisines(amenity) : null
})

const osmUrl = computed(() => {
  if (!props.place) return ''
  const osmSource = props.place.sources.find(s => s.id === SOURCE.OSM)
  return osmSource?.url || ''
})

const coordinates = computed(() => {
  if (!props.place?.geometry) return null
  return props.place.geometry.center
})

const phoneValue = computed(() => props.place?.contactInfo.phone?.value)
const websiteValue = computed(() => props.place?.contactInfo.website?.value)
const emailValue = computed(() => props.place?.contactInfo.email?.value)

const wifiStatus = computed(() => {
  if (!props.place) return null
  const wifiAmenity = props.place.amenities?.['internet_access']?.[0]
    ?.value as string
  if (!wifiAmenity) return null

  const wifiTags = {
    internet_access: wifiAmenity,
    'internet_access:ssid': props.place.amenities?.['internet_access:ssid']?.[0]
      ?.value as string,
    'internet_access:fee': props.place.amenities?.['internet_access:fee']?.[0]
      ?.value as string,
    'internet_access:password': props.place.amenities?.[
      'internet_access:password'
    ]?.[0]?.value as string,
  }

  return getWifiStatus(wifiTags)
})

const outdoorSeating = computed(() => {
  if (!props.place) return false
  const seating = props.place.amenities?.['outdoor_seating']?.[0]?.value
  return seating === 'yes' || seating === true
})

const wheelchairAccess = computed(
  () => props.place?.amenities.wheelchair || null,
)
const smokingStatus = computed(() => props.place?.amenities.smoking || null)
const restroomAccess = computed(() => props.place?.amenities.toilets || null)
const wheelchairRestroomAccess = computed(
  () => props.place?.amenities['toilets:wheelchair'] || null,
)

function formatCoordinates(lat: number, lng: number) {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

const plusCode = computed(() => {
  if (!coordinates.value) return null
  return encode(
    {
      latitude: coordinates.value.lat,
      longitude: coordinates.value.lng,
    },
    10,
  )
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Cuisines -->
    <div v-if="cuisines && cuisines.length > 0" class="flex gap-3 items-center">
      <UtensilsCrossedIcon class="size-4 text-muted-foreground flex-shrink-0" />
      <div class="flex flex-wrap gap-1">
        <span
          v-for="cuisine in cuisines"
          :key="cuisine"
          class="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary transition-colors"
        >
          {{ cuisine }}
        </span>
      </div>
    </div>

    <!-- Hours -->
    <PlaceHours
      v-if="place.openingHours"
      :hours="place.openingHours"
      :osmUrl="osmUrl"
    />

    <!-- Address -->
    <DetailItem
      v-if="place.address"
      :icon="MapPinIcon"
      :value="place.address.street1 || ''"
      :description="
        place.address.locality
          ? `${place.address.locality}${
              place.address.region ? `, ${place.address.region}` : ''
            } ${place.address.postalCode || ''}`
          : ''
      "
      :copyValue="place.address.formatted || ''"
      :osmUrl="osmUrl"
      :coordinates="coordinates"
      label="Address"
    />

    <!-- Phone -->
    <DetailItem
      v-if="phoneValue"
      :icon="PhoneIcon"
      :value="phoneValue"
      :copyValue="phoneValue"
      :osmUrl="osmUrl"
      :href="`tel:${phoneValue}`"
      label="Phone number"
    />

    <!-- Website -->
    <DetailItem
      v-if="websiteValue"
      :icon="LinkIcon"
      :value="websiteValue"
      :osmUrl="osmUrl"
      :copyValue="websiteValue"
      :href="websiteValue"
      target="_blank"
      label="URL"
    />

    <!-- Email -->
    <DetailItem
      v-if="emailValue"
      :icon="MailIcon"
      :value="emailValue"
      :copyValue="emailValue"
      :osmUrl="osmUrl"
      :href="`mailto:${emailValue}`"
      label="Email address"
    />

    <!-- WiFi -->
    <DetailItem
      v-if="wifiStatus"
      :icon="WifiIcon"
      :value="wifiStatus.label"
      :copyValue="wifiStatus.password"
      :osmUrl="osmUrl"
      label="WiFi password"
    >
      <template v-if="wifiStatus.ssid">
        <span class="text-muted-foreground text-sm">
          Network: {{ wifiStatus.ssid }}
        </span>
      </template>
    </DetailItem>

    <!-- Outdoor Seating -->
    <DetailItem
      v-if="outdoorSeating"
      :icon="TreesIcon"
      value="Has outdoor seating"
    />

    <!-- Wheelchair Access -->
    <DetailItem
      v-if="wheelchairAccess"
      :icon="AccessibilityIcon"
      :value="
        wheelchairAccess === 'yes'
          ? 'Wheelchair accessible'
          : 'Not wheelchair accessible'
      "
    />

    <!-- Smoking -->
    <DetailItem
      v-if="smokingStatus"
      :icon="CigaretteIcon"
      :value="
        smokingStatus === 'no'
          ? 'No smoking'
          : smokingStatus === 'outside'
          ? 'Smoking allowed outside'
          : 'Smoking allowed'
      "
    />

    <!-- Restroom Access -->
    <DetailItem
      v-if="restroomAccess || wheelchairRestroomAccess"
      :icon="ToiletIcon"
      :value="
        wheelchairRestroomAccess === 'yes'
          ? 'Wheelchair accessible restroom'
          : restroomAccess === 'yes'
          ? 'Has restroom'
          : 'No restroom'
      "
    />

    <!-- Coordinates -->
    <DetailItem
      v-if="coordinates"
      :icon="GlobeIcon"
      :value="formatCoordinates(coordinates.lat, coordinates.lng)"
      :copyValue="formatCoordinates(coordinates.lat, coordinates.lng)"
      :osmUrl="osmUrl"
      :coordinates="coordinates"
      label="Coordinates"
    />

    <!-- Plus Code -->
    <DetailItem
      v-if="plusCode"
      :icon="PlusIcon"
      :value="plusCode"
      :copyValue="plusCode"
      :osmUrl="osmUrl"
      :coordinates="coordinates"
      label="Plus code"
    />
  </div>
</template>
