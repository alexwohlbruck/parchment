<script setup lang="ts">
import { ref, onMounted, watch, computed, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { encode } from 'pluscodes'
import { Button } from '@/components/ui/button'
import { usePlaceService } from '@/services/place.service'
import { Spinner } from '@/components/ui/spinner'
import {
  NavigationIcon,
  ShareIcon,
  ClockIcon,
  PhoneIcon,
  GlobeIcon,
  MapPinIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  UtensilsCrossedIcon,
  WifiIcon,
  TreesIcon,
  AccessibilityIcon,
  CigaretteIcon,
  ToiletIcon,
  MailIcon,
  LinkIcon,
  PlusIcon,
  XIcon,
  StarIcon,
} from 'lucide-vue-next'
import {
  getWheelchairAccess,
  getSmokingStatus,
  getRestroomAccess,
  hasOutdoorSeating,
  getWifiStatus,
  parseCuisines,
  formatAddress,
  parseOpeningHours,
  isPlaceOpen,
} from '@/lib/place.utils'
import { useAppService } from '@/services/app.service'
import CopyButton from '@/components/CopyButton.vue'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { TransitionExpand } from '@morev/vue-transitions'
import { useMapService } from '@/services/map.service'
import { MarkerIds } from '@/types/map.types'
import { LngLat } from 'mapbox-gl'
import { AppRoute } from '@/router'
import { useDirectionsService } from '@/services/directions.service'
import { useResponsive } from '@/lib/utils'
import {
  getPrimaryPhoto,
  getLogoPhoto,
  getSourceById,
} from '@/types/unified-place.types'
import type { UnifiedPlace, OpeningHours } from '@/types/unified-place.types'
import { SOURCE } from '../lib/constants'

const route = useRoute()
const router = useRouter()
const { currentPlace, loading, fetchPlaceDetails, clearPlace } =
  usePlaceService()
const { toast } = useAppService()
const { flyTo, addMarker, removeAllMarkers } = useMapService()
const directionsService = useDirectionsService()
const { isMobileScreen } = useResponsive()

const placeType = computed(() => currentPlace.value?.placeType || 'Place')

const rating = computed(
  () => currentPlace.value?.ratings?.rating?.value || null,
)
const reviewCount = computed(
  () => currentPlace.value?.ratings?.reviewCount?.value || 0,
)

const address = computed(() => currentPlace.value?.address || null)
const formattedAddress = computed(() => address.value?.formatted || '')

const showTags = ref(false)
const showHours = ref(false)

const openingHours = computed(() => currentPlace.value?.openingHours || null)

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const openingStatus = computed(() => {
  if (!currentPlace.value?.openingHours) return null

  const hours = currentPlace.value.openingHours

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

const osmUrl = computed(() => {
  if (!currentPlace.value) return ''
  const osmSource = currentPlace.value.sources.find(s => s.id === SOURCE.OSM)
  return osmSource?.url || ''
})

const cuisines = computed(() => {
  if (!currentPlace.value) return null
  const amenity = currentPlace.value.amenities?.cuisine?.[0]?.value as string
  return amenity ? parseCuisines(amenity) : null
})

const placeImage = computed(() =>
  currentPlace.value ? getPrimaryPhoto(currentPlace.value)?.url : null,
)

const brandLogo = computed(() =>
  currentPlace.value ? getLogoPhoto(currentPlace.value)?.url : null,
)

const imageLoading = ref(false)
const logoLoading = ref(false)
const imageError = ref(false)
const logoError = ref(false)
const placeImageLoaded = ref(false)
const brandLogoLoaded = ref(false)
const currentPhotoIndex = ref(0)

// Reset loading and error states when currentPlace changes
watch(
  () => currentPlace.value,
  newPlace => {
    if (newPlace) {
      const primaryPhoto = getPrimaryPhoto(newPlace)
      const logoPhoto = getLogoPhoto(newPlace)
      imageLoading.value = !!primaryPhoto && !placeImageLoaded.value
      logoLoading.value = !!logoPhoto && !brandLogoLoaded.value
      imageError.value = false
      logoError.value = false
      placeImageLoaded.value = false
      currentPhotoIndex.value = 0
    }
  },
)

const wifiStatus = computed(() => {
  if (!currentPlace.value) return null
  const wifiAmenity = currentPlace.value.amenities?.['internet_access']?.[0]
    ?.value as string
  if (!wifiAmenity) return null

  // Simulate the old structure for the utility function
  const wifiTags = {
    internet_access: wifiAmenity,
    'internet_access:ssid': currentPlace.value.amenities?.[
      'internet_access:ssid'
    ]?.[0]?.value as string,
    'internet_access:fee': currentPlace.value.amenities?.[
      'internet_access:fee'
    ]?.[0]?.value as string,
    'internet_access:password': currentPlace.value.amenities?.[
      'internet_access:password'
    ]?.[0]?.value as string,
  }

  return getWifiStatus(wifiTags)
})

const outdoorSeating = computed(() => {
  if (!currentPlace.value) return false
  const seating = currentPlace.value.amenities?.['outdoor_seating']?.[0]?.value
  return seating === 'yes' || seating === true
})

const wheelchairAccess = computed(
  () => currentPlace.value?.amenities.wheelchair || null,
)
const smokingStatus = computed(
  () => currentPlace.value?.amenities.smoking || null,
)
const restroomAccess = computed(
  () => currentPlace.value?.amenities.toilets || null,
)
const wheelchairRestroomAccess = computed(
  () => currentPlace.value?.amenities['toilets:wheelchair'] || null,
)

const coordinates = computed(() => {
  if (!currentPlace.value?.geometry) return null
  return currentPlace.value.geometry.center
})

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

const phoneValue = computed(() => currentPlace.value?.contactInfo.phone?.value)
const websiteValue = computed(
  () => currentPlace.value?.contactInfo.website?.value,
)
const emailValue = computed(() => {
  console.log(JSON.stringify(currentPlace.value))
  return currentPlace.value?.contactInfo.email?.value
})

const osmSource = computed(() => {
  if (!currentPlace.value) return null
  return currentPlace.value.sources.find(s => s.id === SOURCE.OSM) || null
})

const description = computed(() => currentPlace.value?.description || null)

async function loadPlace(type: string, id: string) {
  clearPlace()
  placeImageLoaded.value = false
  brandLogoLoaded.value = false

  const place = await fetchPlaceDetails(id, type as any)

  // Add marker when place loads
  if (place && place.geometry) {
    const { lat, lng } = place.geometry.center

    if (lat && lng) {
      removeAllMarkers()
      addMarker(MarkerIds.SELECTED_POI, new LngLat(lng, lat))

      flyTo({
        center: new LngLat(lng, lat),
        zoom: 17,
      })
    }
  }
}

onMounted(async () => {
  const { type, id } = route.params
  if (typeof type === 'string' && typeof id === 'string') {
    await loadPlace(type, id)
  }
})

watch(
  () => route.params,
  async params => {
    const { type, id } = params
    if (typeof type === 'string' && typeof id === 'string') {
      await loadPlace(type, id)
    }
  },
)

function formatOpeningHours(hours: OpeningHours | null) {
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

onUnmounted(() => {
  removeAllMarkers()
})

function sharePlace() {
  const url = window.location.href
  if (navigator.share) {
    try {
      const name = currentPlace.value?.name || ''
      navigator.share({
        url,
        title: name,
        text: name,
      })
      return
    } catch (err) {
      navigator.clipboard.writeText(url)
      toast.info('Link copied to clipboard')
    }
  }
}

function handleDirectionsClick() {
  if (!coordinates.value) return

  const waypoint = {
    lngLat: new LngLat(coordinates.value.lng, coordinates.value.lat),
  }

  directionsService.directionsTo(waypoint)
  router.push({ name: AppRoute.DIRECTIONS })
}

function handlePlaceImageLoad() {
  placeImageLoaded.value = true
  imageLoading.value = false
}

function handleBrandLogoLoad() {
  brandLogoLoaded.value = true
  logoLoading.value = false
}

function handlePlaceImageError() {
  imageError.value = true
  imageLoading.value = false
}

function handleBrandLogoError() {
  logoError.value = true
  logoLoading.value = false
}

function formatRating(rating: number | null): string {
  if (rating === null) return '0'
  return (rating * 5).toFixed(1)
}

function formatDate(dateString: string) {
  try {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat(navigator.language, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(date)
  } catch (e) {
    console.error('Error formatting date:', e)
    return dateString
  }
}
</script>

<template>
  <div class="h-full flex flex-col relative">
    <div
      v-if="loading"
      class="h-full p-4 flex items-center justify-center py-8"
    >
      <Spinner class="w-6 h-6" />
    </div>

    <template v-else-if="currentPlace">
      <div class="flex flex-col gap-4 pt-4">
        <div class="flex flex-col px-4 space-y-0">
          <!-- Title, Type, and Rating Section -->
          <div class="flex flex-col gap-2">
            <div class="flex items-start justify-between gap-2">
              <!-- Brand Logo -->
              <div
                v-if="logoLoading || brandLogo || logoError"
                class="size-12 rounded-lg overflow-hidden border border-border shadow flex-shrink-0 mr-2"
              >
                <div
                  v-if="logoLoading"
                  class="w-full h-full bg-muted/50 animate-pulse relative overflow-hidden"
                >
                  <div
                    class="absolute inset-0 -translate-x-full animate-[shimmer_1s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  />
                </div>
                <div v-if="brandLogo" class="w-full h-full">
                  <transition
                    enter-from-class="opacity-0"
                    enter-to-class="opacity-100"
                    enter-active-class="transition-opacity duration-200"
                  >
                    <img
                      v-show="brandLogoLoaded"
                      :src="brandLogo"
                      :alt="currentPlace.name + ' logo'"
                      class="w-full h-full object-contain bg-white"
                      @load="handleBrandLogoLoad"
                      @error="handleBrandLogoError"
                    />
                  </transition>
                </div>
                <div
                  v-if="logoError"
                  class="w-full h-full flex items-center justify-center bg-muted"
                />
              </div>

              <div class="flex-1">
                <h1 class="text-2xl font-semibold line-clamp-2">
                  {{ currentPlace.name }}
                </h1>
                <div class="text-sm text-muted-foreground">
                  {{ placeType }}
                </div>
                <div
                  v-if="rating !== null"
                  class="flex items-center gap-1 mt-1"
                >
                  <div class="flex">
                    <StarIcon
                      v-for="i in Math.floor(rating * 5)"
                      :key="i"
                      class="w-3 h-3 fill-current text-yellow-400"
                    />
                    <StarIcon
                      v-for="i in 5 - Math.floor(rating * 5)"
                      :key="i + 5"
                      class="w-3 h-3 text-muted-foreground"
                    />
                  </div>
                  <span class="text-sm">
                    {{ (rating * 5).toFixed(1) }}
                    <span class="text-muted-foreground"
                      >({{ reviewCount }})</span
                    >
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                @click="router.push({ name: AppRoute.MAP })"
              >
                <XIcon class="size-4" />
              </Button>
            </div>

            <!-- Description Section -->
            <div v-if="description">
              <p class="text-sm text-muted-foreground leading-relaxed">
                {{ description }}
              </p>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="px-4 flex gap-2">
          <Button class="flex-1" @click="handleDirectionsClick">
            <NavigationIcon class="mr-2 h-4 w-4" />
            Directions
          </Button>
          <Button variant="outline" class="flex-1" @click="sharePlace">
            <ShareIcon class="mr-2 h-4 w-4" />
            Share
          </Button>
        </div>

        <!-- Main Image - Full bleed -->
        <TransitionExpand>
          <div v-if="currentPlace.photos.length > 0" class="w-full relative">
            <div
              class="w-full overflow-x-auto snap-x snap-mandatory flex gap-2"
              style="scrollbar-width: none; -ms-overflow-style: none"
            >
              <div
                v-for="(photo, index) in currentPlace.photos"
                :key="index"
                class="w-[calc(100%-2rem)] flex-none snap-center relative aspect-video first:ml-4 last:mr-4 rounded-lg overflow-hidden"
              >
                <div
                  v-if="imageLoading && !placeImageLoaded"
                  class="absolute inset-0 bg-muted/50 animate-pulse"
                >
                  <div
                    class="absolute inset-0 -translate-x-full animate-[shimmer_1s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  />
                </div>
                <img
                  :src="photo.url"
                  :alt="currentPlace.name"
                  class="w-full h-full object-cover"
                  @load="handlePlaceImageLoad"
                  @error="handlePlaceImageError"
                />
                <div
                  v-if="imageError"
                  class="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
                >
                  Failed to load image
                </div>
              </div>
            </div>
          </div>
        </TransitionExpand>

        <!-- Details -->
        <div class="px-4 flex flex-col gap-4">
          <!-- Cuisines -->
          <div
            v-if="cuisines && cuisines.length > 0"
            class="flex gap-3 items-center"
          >
            <UtensilsCrossedIcon
              class="size-4 text-muted-foreground flex-shrink-0"
            />
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

          <!-- Address -->
          <div v-if="address" class="flex gap-3 items-center group">
            <MapPinIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1 py-1">
              <template v-if="address.street1">
                <span>
                  {{ address.street1 }}
                </span>
                <span
                  v-if="
                    address.locality || address.region || address.postalCode
                  "
                  class="text-muted-foreground text-sm"
                >
                  {{ address.locality
                  }}{{ address.locality && address.region ? ',' : '' }}
                  {{ address.region }}
                  {{ address.postalCode }}
                </span>
                <span
                  v-if="address.country"
                  class="text-muted-foreground text-sm"
                >
                  {{ address.country }}
                </span>
              </template>
              <template v-else>
                <span>{{ address.formatted }}</span>
              </template>
            </div>
            <div
              class="flex opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <CopyButton
                :text="formattedAddress"
                message="Address copied to clipboard"
              />
              <a
                v-if="osmUrl"
                :href="`${osmUrl}#map=19/${coordinates?.lat}/${coordinates?.lng}`"
                target="_blank"
                rel="noopener noreferrer"
                class="p-1 hover:bg-muted rounded"
                title="View on OpenStreetMap"
              >
                <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
              </a>
            </div>
          </div>

          <!-- Opening Hours -->
          <div v-if="openingHours" class="flex gap-3 items-center group">
            <ClockIcon
              class="size-4 text-muted-foreground flex-shrink-0"
              :class="openingStatus?.color"
            />
            <div class="flex flex-col flex-1">
              <div class="flex items-center gap-2">
                <span :class="openingStatus?.color">{{
                  openingStatus?.status
                }}</span>
                <button
                  class="text-sm text-muted-foreground hover:text-foreground text-left"
                  @click="showHours = !showHours"
                >
                  See hours
                </button>
              </div>
              <div
                v-show="showHours"
                class="text-sm text-muted-foreground mt-1"
              >
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
                        openingHours.regularHours.find(
                          h => h.day === DAYS.indexOf(day),
                        )
                      "
                    >
                      {{
                        formatTime(
                          openingHours.regularHours.find(
                            h => h.day === DAYS.indexOf(day),
                          )!.open,
                        )
                      }}
                      -
                      {{
                        formatTime(
                          openingHours.regularHours.find(
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
            <div
              class="flex opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <CopyButton
                :text="formatOpeningHours(openingHours)"
                message="Hours copied to clipboard"
              />
              <a
                v-if="osmUrl"
                :href="osmUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="p-1 hover:bg-muted rounded"
                title="View on OpenStreetMap"
              >
                <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
              </a>
            </div>
          </div>

          <!-- Phone -->
          <div v-if="phoneValue" class="flex gap-3 items-center group">
            <PhoneIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1">
              <a
                :href="`tel:${phoneValue}`"
                class="text-primary hover:underline"
              >
                {{ phoneValue }}
              </a>
            </div>
            <div
              class="flex opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <CopyButton
                :text="phoneValue"
                message="Phone number copied to clipboard"
              />
              <a
                v-if="osmUrl"
                :href="osmUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="p-1 hover:bg-muted rounded"
                title="View on OpenStreetMap"
              >
                <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
              </a>
            </div>
          </div>

          <!-- Website -->
          <div v-if="websiteValue" class="flex gap-3 items-center">
            <LinkIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <a
              :href="websiteValue"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary hover:underline truncate"
            >
              {{ websiteValue }}
            </a>
          </div>

          <!-- Email -->
          <div v-if="emailValue" class="flex gap-3 items-center group">
            <MailIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <a
              :href="`mailto:${emailValue}`"
              class="text-primary hover:underline truncate"
            >
              {{ emailValue }}
            </a>
            <div
              class="flex opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <CopyButton
                :text="emailValue"
                message="Email copied to clipboard"
              />
              <a
                v-if="osmUrl"
                :href="osmUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="p-1 hover:bg-muted rounded"
                title="View on OpenStreetMap"
              >
                <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
              </a>
            </div>
          </div>

          <!-- WiFi -->
          <div v-if="wifiStatus" class="flex gap-3 items-center group">
            <WifiIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1 py-1">
              <span>{{ wifiStatus.label }}</span>
              <span
                v-if="wifiStatus.ssid"
                class="text-muted-foreground text-sm"
              >
                Network: {{ wifiStatus.ssid }}
              </span>
              <span
                v-if="wifiStatus.password"
                class="text-muted-foreground text-sm"
              >
                Password: {{ wifiStatus.password }}
              </span>
            </div>
            <div
              class="flex opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <CopyButton
                v-if="wifiStatus.password"
                :text="wifiStatus.password"
                message="Password copied to clipboard"
              />
              <a
                v-if="osmUrl"
                :href="osmUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="p-1 hover:bg-muted rounded"
                title="View on OpenStreetMap"
              >
                <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
              </a>
            </div>
          </div>

          <!-- Outdoor Seating -->
          <div v-if="outdoorSeating" class="flex gap-3 items-center">
            <TreesIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <span>Has outdoor seating</span>
          </div>

          <!-- Wheelchair Access -->
          <div v-if="wheelchairAccess" class="flex gap-3 items-center">
            <AccessibilityIcon
              class="size-4 text-muted-foreground flex-shrink-0"
            />
            <span>
              {{
                wheelchairAccess === 'yes'
                  ? 'Wheelchair accessible'
                  : 'Not wheelchair accessible'
              }}
            </span>
          </div>

          <!-- Smoking -->
          <div v-if="smokingStatus" class="flex gap-3 items-center">
            <CigaretteIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <span>
              {{ smokingStatus === 'yes' ? 'Smoking allowed' : 'No smoking' }}
            </span>
          </div>

          <!-- Restrooms -->
          <div v-if="restroomAccess" class="flex gap-3 items-center">
            <ToiletIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col">
              <span>{{
                restroomAccess === 'yes'
                  ? 'Restrooms available'
                  : 'No restrooms'
              }}</span>
              <span
                v-if="wheelchairRestroomAccess"
                class="text-sm text-muted-foreground"
              >
                {{
                  wheelchairRestroomAccess === 'yes'
                    ? 'Wheelchair accessible restrooms'
                    : 'No wheelchair accessible restrooms'
                }}
              </span>
            </div>
          </div>

          <!-- Coordinates -->
          <div v-if="coordinates" class="flex gap-3 items-center group">
            <GlobeIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1">
              <span class="text-sm">
                {{ formatCoordinates(coordinates.lat, coordinates.lng) }}
              </span>
            </div>
            <div
              class="flex opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <CopyButton
                :text="formatCoordinates(coordinates.lat, coordinates.lng)"
                message="Coordinates copied to clipboard"
              />
              <a
                v-if="osmUrl"
                :href="`${osmUrl}#map=19/${coordinates.lat}/${coordinates.lng}`"
                target="_blank"
                rel="noopener noreferrer"
                class="p-1 hover:bg-muted rounded"
                title="View on OpenStreetMap"
              >
                <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
              </a>
            </div>
          </div>

          <!-- Plus Code -->
          <div v-if="plusCode" class="flex gap-3 items-center group">
            <PlusIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1">
              <span class="text-sm">
                {{ plusCode }}
              </span>
            </div>
            <div
              class="flex opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <CopyButton
                :text="plusCode"
                message="Plus code copied to clipboard"
              />
              <a
                v-if="osmUrl"
                :href="`${osmUrl}#map=19/${coordinates?.lat}/${coordinates?.lng}`"
                target="_blank"
                rel="noopener noreferrer"
                class="p-1 hover:bg-muted rounded"
                title="View on OpenStreetMap"
              >
                <ExternalLinkIcon class="w-4 h-4 text-muted-foreground" />
              </a>
            </div>
          </div>
        </div>

        <!-- Sources -->
        <div class="px-4 flex flex-col gap-2">
          <h2 class="text-sm font-medium">Sources</h2>
          <!-- Source Info -->
          <div
            v-for="source in currentPlace.sources"
            :key="source.id"
            class="border border-border rounded-lg overflow-hidden"
          >
            <div class="pl-3 pr-1 py-1 flex flex-col">
              <div class="flex items-center justify-between">
                <div class="flex-1">
                  <div class="flex items-center justify-between">
                    <button
                      v-if="source.id === 'osm'"
                      @click="showTags = !showTags"
                      class="flex-1 flex items-center justify-between"
                    >
                      <div class="div flex flex-col items-start">
                        <span class="text-sm">{{ source.name }}</span>
                        <span
                          v-if="source.updated"
                          class="text-xs text-muted-foreground text-start"
                        >
                          Last updated
                          {{ formatDate(source.updated) }}
                          {{ source.updatedBy ? `by ${source.updatedBy}` : '' }}
                        </span>
                      </div>
                      <ChevronDownIcon
                        class="size-4 text-muted-foreground transition-transform"
                        :class="{ 'rotate-180': showTags }"
                      />
                    </button>
                    <div v-else class="flex-1 flex flex-col items-start">
                      <span class="text-sm">{{ source.name }}</span>
                      <span
                        v-if="source.updated"
                        class="text-xs text-muted-foreground"
                      >
                        Last updated
                        {{ formatDate(source.updated) }}
                        {{ source.updatedBy ? `by ${source.updatedBy}` : '' }}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="ml-2"
                      asChild
                      v-if="source.url"
                    >
                      <a
                        :href="source.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        :title="`View on ${source.name}`"
                      >
                        <ExternalLinkIcon class="size-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="source.id === 'osm' && showTags">
              <Table>
                <TableBody>
                  <TableRow
                    v-for="[key, value] in Object.entries(
                      currentPlace.amenities || {},
                    )"
                    :key="key"
                  >
                    <TableCell class="font-medium text-muted-foreground">
                      {{ key }}
                    </TableCell>
                    <TableCell class="break-all">
                      {{ value }}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style>
/* Hide scrollbar for Chrome, Safari and Opera */
.snap-x::-webkit-scrollbar {
  display: none;
}

/* Hide scrollbar for IE, Edge and Firefox */
.snap-x {
  -ms-overflow-style: none; /* IE and Edge */
  scrollbar-width: none; /* Firefox */
}

/* Active indicator dot */
.snap-x::-webkit-scrollbar-thumb {
  background-color: white;
}
</style>
