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
  getBestName,
  getBestPlaceType,
  getBestAddress,
  getBestPhone,
  getBestEmail,
  getBestWebsite,
  getPrimaryPhoto,
  getLogoPhoto,
  getOpeningHours,
  getFormattedAddress,
  OpeningHours,
} from '@/types/unified-place.types'

const route = useRoute()
const router = useRouter()
const { currentPlace, loading, fetchPlaceDetails, clearPlace } =
  usePlaceService()
const { toast } = useAppService()
const { flyTo, addMarker, removeAllMarkers } = useMapService()
const directionsService = useDirectionsService()
const { isMobileScreen } = useResponsive()

const placeType = computed(() => {
  if (!currentPlace.value) return 'Place'
  return getBestPlaceType(currentPlace.value)
})

const formattedAddress = computed(() => {
  if (!currentPlace.value) return ''
  return getFormattedAddress(currentPlace.value) || ''
})

const showTags = ref(false)
const showHours = ref(false)

const openingHours = computed(() => {
  if (!currentPlace.value) return null
  return getOpeningHours(currentPlace.value)
})

const openingStatus = computed(() => {
  const hours = openingHours.value
  if (!hours || !hours.regularHours) return null

  const status = isPlaceOpen(hours.regularHours)
  if (!status) return null

  if (status.isOpen) {
    return {
      state: 'open',
      message: 'Open now',
      closingTime: status.nextChange,
    }
  } else {
    return {
      state: 'closed',
      message: status.nextChange ? `Opens ${status.nextChange}` : 'Closed',
    }
  }
})

const osmUrl = computed(() => {
  if (!currentPlace.value) return ''
  const osmSource = currentPlace.value.sources.find(s => s.id === 'osm')
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

const wheelchairAccessText = computed(() => {
  if (!currentPlace.value) return 'Unknown wheelchair accessibility'
  const wheelchair = currentPlace.value.amenities?.['wheelchair']?.[0]
    ?.value as string
  return getWheelchairAccess({ wheelchair })
})

const smokingStatusText = computed(() => {
  if (!currentPlace.value) return 'Unknown smoking policy'
  const smoking = currentPlace.value.amenities?.['smoking']?.[0]
    ?.value as string
  return getSmokingStatus({ smoking })
})

const restroomAccessText = computed(() => {
  if (!currentPlace.value) return 'Unknown restroom availability'
  const toilets = currentPlace.value.amenities?.['toilets']?.[0]
    ?.value as string
  return getRestroomAccess({ toilets })
})

const coordinates = computed(() => {
  if (!currentPlace.value) return null

  const geometry = currentPlace.value.geometry[0]?.value
  if (!geometry) return null

  return {
    lat: geometry.center.lat,
    lng: geometry.center.lng,
  }
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

async function loadPlace(type: string, id: string) {
  clearPlace()
  placeImageLoaded.value = false
  brandLogoLoaded.value = false

  const place = await fetchPlaceDetails(id, type as any)

  // Add marker when place loads
  if (place && place.geometry?.length > 0) {
    const geometry = place.geometry[0].value
    const { lat, lng } = geometry.center

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
      const name = currentPlace.value ? getBestName(currentPlace.value) : ''
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
      <div class="p-4 flex flex-col gap-4">
        <!-- Title section with brand logo -->
        <div class="flex items-center gap-4">
          <!-- Brand Logo -->
          <div
            v-if="logoLoading || brandLogo || logoError"
            class="size-12 rounded-lg overflow-hidden border border-border shadow flex-shrink-0"
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
                  :alt="getBestName(currentPlace) + ' logo'"
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
            <h1 class="text-2xl font-semibold leading-7">
              {{ getBestName(currentPlace) }}
            </h1>
            <p class="text-muted-foreground">
              {{ placeType }}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            @click="router.push({ name: AppRoute.MAP })"
          >
            <XIcon class="size-4" />
          </Button>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-2">
          <Button class="flex-1" @click="handleDirectionsClick">
            <NavigationIcon class="mr-2 h-4 w-4" />
            Directions
          </Button>
          <Button variant="outline" class="flex-1" @click="sharePlace">
            <ShareIcon class="mr-2 h-4 w-4" />
            Share
          </Button>
        </div>

        <!-- Main Image -->
        <TransitionExpand>
          <div
            v-if="imageLoading || placeImage || imageError"
            class="w-full relative aspect-video rounded-lg overflow-hidden"
          >
            <div
              v-if="imageLoading"
              class="absolute inset-0 bg-muted/50 animate-pulse"
            >
              <div
                class="absolute inset-0 -translate-x-full animate-[shimmer_1s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent"
              />
            </div>
            <div v-if="placeImage" class="absolute inset-0">
              <transition
                enter-from-class="opacity-0"
                enter-to-class="opacity-100"
                enter-active-class="transition-opacity duration-200"
              >
                <img
                  v-show="placeImageLoaded"
                  :src="placeImage"
                  :alt="getBestName(currentPlace)"
                  class="w-full h-full object-cover"
                  @load="handlePlaceImageLoad"
                  @error="handlePlaceImageError"
                />
              </transition>
            </div>
            <div
              v-if="imageError"
              class="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
            >
              Failed to load image
            </div>
          </div>
        </TransitionExpand>

        <!-- Details -->
        <div class="flex flex-col gap-4">
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
          <div
            v-if="getBestAddress(currentPlace)"
            class="flex gap-3 items-center group"
          >
            <MapPinIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1 py-1">
              <span>
                {{ getBestAddress(currentPlace)?.street1 }}
              </span>
              <span
                v-if="
                  getBestAddress(currentPlace)?.locality ||
                  getBestAddress(currentPlace)?.region ||
                  getBestAddress(currentPlace)?.postalCode
                "
                class="text-muted-foreground text-sm"
              >
                {{ getBestAddress(currentPlace)?.locality
                }}{{
                  getBestAddress(currentPlace)?.locality &&
                  getBestAddress(currentPlace)?.region
                    ? ','
                    : ''
                }}
                {{ getBestAddress(currentPlace)?.region }}
                {{ getBestAddress(currentPlace)?.postalCode }}
              </span>
              <span
                v-if="getBestAddress(currentPlace)?.country"
                class="text-muted-foreground text-sm"
              >
                {{ getBestAddress(currentPlace)?.country }}
              </span>
            </div>
            <CopyButton
              :text="formattedAddress"
              message="Address copied to clipboard"
            />
          </div>

          <!-- Opening Hours -->
          <div v-if="openingHours" class="flex gap-3 items-center group">
            <ClockIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1">
              <div class="flex items-center gap-2">
                <span
                  :class="[
                    'text-sm font-medium',
                    openingStatus?.state === 'open'
                      ? 'text-green-600 dark:text-green-500'
                      : 'text-red-600 dark:text-red-500',
                  ]"
                >
                  {{ openingStatus?.message }}
                </span>
                <span
                  v-if="openingStatus?.closingTime"
                  class="text-sm text-muted-foreground"
                >
                  · Closes {{ openingStatus.closingTime }}
                </span>
              </div>
              <button
                class="text-sm text-muted-foreground hover:text-foreground text-left"
                @click="showHours = !showHours"
              >
                See hours
              </button>
              <pre
                v-show="showHours"
                class="whitespace-pre-line text-sm mt-1"
                >{{ formatOpeningHours(openingHours) }}</pre
              >
            </div>
          </div>

          <!-- Phone -->
          <div
            v-if="getBestPhone(currentPlace)"
            class="flex gap-3 items-center group"
          >
            <PhoneIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1">
              <a
                :href="
                  getBestPhone(currentPlace)
                    ? `tel:${getBestPhone(currentPlace)}`
                    : undefined
                "
                class="text-primary hover:underline"
              >
                {{ getBestPhone(currentPlace) }}
              </a>
            </div>
            <CopyButton
              :text="getBestPhone(currentPlace) || ''"
              message="Phone number copied to clipboard"
              class="opacity-0 group-hover:opacity-100"
            />
          </div>

          <!-- Website -->
          <div
            v-if="getBestWebsite(currentPlace)"
            class="flex gap-3 items-center"
          >
            <LinkIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <a
              :href="getBestWebsite(currentPlace) || undefined"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary hover:underline truncate"
            >
              {{ getBestWebsite(currentPlace) }}
            </a>
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
            <CopyButton
              v-if="wifiStatus.password"
              :text="wifiStatus.password"
              message="Password copied to clipboard"
              class="opacity-0 group-hover:opacity-100"
            />
          </div>

          <!-- Outdoor Seating -->
          <div v-if="outdoorSeating" class="flex gap-3 items-center">
            <TreesIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <span>Has outdoor seating</span>
          </div>

          <!-- Wheelchair Access -->
          <div
            v-if="currentPlace.amenities?.wheelchair"
            class="flex gap-3 items-center"
          >
            <AccessibilityIcon
              class="size-4 text-muted-foreground flex-shrink-0"
            />
            <span>
              {{ wheelchairAccessText }}
            </span>
          </div>

          <!-- Smoking -->
          <div
            v-if="currentPlace.amenities?.smoking"
            class="flex gap-3 items-center"
          >
            <CigaretteIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <span>
              {{ smokingStatusText }}
            </span>
          </div>

          <!-- Restrooms -->
          <div
            v-if="currentPlace.amenities?.toilets"
            class="flex gap-3 items-center"
          >
            <ToiletIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col">
              <span>{{ restroomAccessText }}</span>
              <span
                v-if="currentPlace.amenities?.['toilets:wheelchair']"
                class="text-sm text-muted-foreground"
              >
                Wheelchair
                {{
                  currentPlace.amenities?.['toilets:wheelchair'][0]?.value ===
                    'yes' ||
                  currentPlace.amenities?.['toilets:wheelchair'][0]?.value ===
                    true
                    ? 'accessible'
                    : 'not accessible'
                }}
              </span>
            </div>
          </div>

          <!-- Email -->
          <div
            v-if="getBestEmail(currentPlace)"
            class="flex gap-3 items-center group"
          >
            <MailIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <a
              :href="
                getBestEmail(currentPlace)
                  ? `mailto:${getBestEmail(currentPlace)}`
                  : undefined
              "
              class="text-primary hover:underline truncate"
            >
              {{ getBestEmail(currentPlace) }}
            </a>
            <CopyButton
              :text="getBestEmail(currentPlace) || ''"
              message="Email copied to clipboard"
              class="opacity-0 group-hover:opacity-100"
            />
          </div>

          <!-- Coordinates -->
          <div v-if="coordinates" class="flex gap-3 items-center group">
            <GlobeIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1">
              <span class="text-sm">
                {{ formatCoordinates(coordinates.lat, coordinates.lng) }}
              </span>
            </div>
            <CopyButton
              :text="formatCoordinates(coordinates.lat, coordinates.lng)"
              message="Coordinates copied to clipboard"
              class="opacity-0 group-hover:opacity-100"
            />
          </div>

          <!-- Plus Code -->
          <div v-if="plusCode" class="flex gap-3 items-center group">
            <PlusIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1">
              <span class="text-sm">
                {{ plusCode }}
              </span>
            </div>
            <CopyButton
              :text="plusCode"
              message="Plus code copied to clipboard"
              class="opacity-0 group-hover:opacity-100"
            />
          </div>
        </div>

        <!-- Sources -->
        <div class="flex flex-col gap-2">
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
                        <span class="text-xs text-muted-foreground text-start">
                          Last updated
                          {{
                            new Date(
                              source.updated || Date.now(),
                            ).toLocaleDateString()
                          }}
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
                      <span class="text-xs text-muted-foreground">
                        Last updated
                        {{
                          new Date(
                            source.updated || Date.now(),
                          ).toLocaleDateString()
                        }}
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
                    v-for="[key, values] in Object.entries(
                      currentPlace.amenities || {},
                    )"
                    :key="key"
                  >
                    <TableCell class="font-medium text-muted-foreground">
                      {{ key }}
                    </TableCell>
                    <TableCell class="break-all">
                      {{ values[0]?.value }}
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
