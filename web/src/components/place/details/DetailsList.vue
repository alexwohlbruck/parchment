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
  ClockIcon,
  MapIcon,
  PlusIcon,
} from 'lucide-vue-next'
import DetailItem from '../DetailItem.vue'
import type { UnifiedPlace } from '@/types/unified-place.types'
import { computed, ref } from 'vue'
import { getWifiStatus, parseCuisines } from '@/lib/place.utils'
import { SOURCE } from '@/lib/constants'
import { encode } from 'pluscodes'

const props = defineProps<{
  place: UnifiedPlace
}>()

const showHours = ref(false)

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

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

const openingStatus = computed(() => {
  const hours = props.place?.openingHours
  if (!hours) return null

  if (hours.isPermanentlyClosed) {
    return { status: 'Permanently closed', color: 'text-red-500' }
  }

  if (hours.isTemporarilyClosed) {
    return { status: 'Temporarily closed', color: 'text-orange-500' }
  }

  if (hours.isOpen24_7) {
    return { status: 'Open 24/7', color: 'text-green-500' }
  }

  const now = new Date()
  const currentDay = now.getDay()
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`

  const todayHours = hours.regularHours.find(h => h.day === currentDay)
  if (!todayHours) {
    return { status: 'Closed today', color: 'text-red-500' }
  }

  if (currentTime >= todayHours.open && currentTime <= todayHours.close) {
    return {
      status: `Open until ${formatTime(todayHours.close)}`,
      color: 'text-green-500',
    }
  } else if (currentTime < todayHours.open) {
    return {
      status: `Opens at ${formatTime(todayHours.open)}`,
      color: 'text-orange-500',
    }
  } else {
    // Find next day's opening time
    let nextDay = (currentDay + 1) % 7
    let daysChecked = 0
    while (daysChecked < 7) {
      const nextDayHours = hours.regularHours.find(h => h.day === nextDay)
      if (nextDayHours) {
        return {
          status: `Opens ${DAYS[nextDay]} at ${formatTime(nextDayHours.open)}`,
          color: 'text-orange-500',
        }
      }
      nextDay = (nextDay + 1) % 7
      daysChecked++
    }
    return { status: 'Closed', color: 'text-red-500' }
  }
})

function formatTime(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour = hours % 12 || 12
  return `${hour}:${minutes.toString().padStart(2, '0')} ${period}`
}

function formatOpeningHours(hours: typeof props.place.openingHours) {
  if (!hours || !hours.rawText) return ''

  if (hours.isPermanentlyClosed) return 'Permanently closed'
  if (hours.isTemporarilyClosed) {
    return hours.nextOpenDate
      ? `Temporarily closed until ${new Date(
          hours.nextOpenDate,
        ).toLocaleDateString()}`
      : 'Temporarily closed'
  }
  if (hours.isOpen24_7) return 'Open 24/7'

  return hours.rawText.split(';').join('\n')
}

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
    <DetailItem
      v-if="place.openingHours"
      :icon="ClockIcon"
      :osmUrl="osmUrl"
      :copyValue="formatOpeningHours(place.openingHours)"
      :color="openingStatus?.color"
      label="Hours"
    >
      <div class="flex flex-col">
        <div class="flex items-center gap-2">
          <span :class="openingStatus?.color">{{ openingStatus?.status }}</span>
          <button
            class="text-sm text-muted-foreground hover:text-foreground text-left"
            @click="showHours = !showHours"
          >
            See hours
          </button>
        </div>
        <div v-show="showHours" class="text-sm text-muted-foreground mt-1">
          <div
            v-for="day in DAYS"
            :key="day"
            class="flex justify-between"
            :class="{ 'font-medium': day === DAYS[new Date().getDay()] }"
          >
            <span>{{ day }}:</span>
            <span>
              <template
                v-if="
                  place.openingHours.regularHours.find(
                    h => h.day === DAYS.indexOf(day),
                  )
                "
              >
                {{
                  formatTime(
                    place.openingHours.regularHours.find(
                      h => h.day === DAYS.indexOf(day),
                    )!.open,
                  )
                }}
                -
                {{
                  formatTime(
                    place.openingHours.regularHours.find(
                      h => h.day === DAYS.indexOf(day),
                    )!.close,
                  )
                }}
              </template>
              <template v-else> Closed </template>
            </span>
          </div>
        </div>
      </div>
    </DetailItem>

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
