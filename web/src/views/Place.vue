<script setup lang="ts">
import { ref, onMounted, watch, computed, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
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
} from 'lucide-vue-next'
import { parseOpeningHours } from '@/lib/map.utils'
import {
  getPlaceType,
  getWheelchairAccess,
  getSmokingStatus,
  getRestroomAccess,
} from '@/lib/place.utils'
import { useAppService } from '@/services/app.service'
import CopyButton from '@/components/CopyButton.vue'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { TransitionExpand } from '@morev/vue-transitions'
import { useMapService } from '@/services/map.service'
import { MarkerIds } from '@/types/map.types'

const route = useRoute()
const { currentPlace, loading, error, fetchPlaceDetails, clearPlace } =
  usePlaceService()
const { toast } = useAppService()
const { flyTo, addMarker, removeAllMarkers } = useMapService()

const placeType = computed(() => {
  return getPlaceType(currentPlace.value?.tags ?? {})
})

const formattedAddress = computed(() => {
  const tags = currentPlace.value?.tags
  if (!tags) return ''

  const parts = [
    `${tags['addr:housenumber'] || ''} ${tags['addr:street'] || ''}`.trim(),
    `${tags['addr:city'] || ''}${
      tags['addr:city'] && tags['addr:state'] ? ',' : ''
    } ${tags['addr:state'] || ''} ${tags['addr:postcode'] || ''}`.trim(),
    tags['addr:country'],
  ].filter(Boolean)

  return parts.join('\n')
})

const showTags = ref(false)
const showHours = ref(false)

const openingStatus = computed(() => {
  const hours = currentPlace.value?.tags.opening_hours
  if (!hours) return null

  const status = parseOpeningHours(hours)
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
  const { type, id } = route.params
  return `https://www.openstreetmap.org/${type}/${id}`
})

const cuisines = computed(() => {
  const cuisine = currentPlace.value?.tags.cuisine
  if (!cuisine) return null

  return cuisine
    .split(';')
    .map(c => c.trim())
    .map(c => c.replace(/_/g, ' '))
    .map(c => c.charAt(0).toUpperCase() + c.slice(1))
})

const placeImage = ref<string | null>(null)
const brandLogo = ref<string | null>(null)
const imageLoading = ref(false)
const logoLoading = ref(false)
const imageError = ref(false)
const logoError = ref(false)
const placeImageLoaded = ref(false)
const brandLogoLoaded = ref(false)

const wifiStatus = computed(() => {
  const access = currentPlace.value?.tags.internet_access
  const ssid = currentPlace.value?.tags['internet_access:ssid']
  const fee = currentPlace.value?.tags['internet_access:fee']
  const password = currentPlace.value?.tags['internet_access:password']

  if (!access || access === 'no') return null

  let label = 'WiFi available'

  if (access === 'free' || fee === 'no') {
    label = 'Free WiFi available'
  } else if (access === 'customers') {
    label = 'WiFi for customers'
  } else if (fee === 'yes') {
    label = 'Paid WiFi available'
  }

  return {
    label,
    ssid,
    password,
  }
})

const hasOutdoorSeating = computed(() => {
  const seating = currentPlace.value?.tags.outdoor_seating
  return seating === 'yes'
})

const wheelchairAccessText = computed(() =>
  getWheelchairAccess(currentPlace.value?.tags ?? {}),
)

const smokingStatusText = computed(() =>
  getSmokingStatus(currentPlace.value?.tags ?? {}),
)

const restroomAccessText = computed(() =>
  getRestroomAccess(currentPlace.value?.tags ?? {}),
)

const coordinates = computed(() => {
  if (!currentPlace.value) return null

  const place = currentPlace.value

  // For nodes, use lat/lon
  if (place.type === 'node' && place.lat && place.lon) {
    return { lat: place.lat, lon: place.lon }
  }

  // For ways/relations, use center
  if (place.center?.lat && place.center?.lon) {
    return { lat: place.center.lat, lon: place.center.lon }
  }

  // If no center, try to use first point of geometry
  if (place.geometry?.[0]) {
    return {
      lat: place.geometry[0].lat,
      lon: place.geometry[0].lon,
    }
  }

  return null
})

const plusCode = computed(() => {
  if (!coordinates.value) return null
  return encode(
    {
      latitude: coordinates.value.lat,
      longitude: coordinates.value.lon,
    },
    10,
  )
})

async function fetchWikidataImage() {
  const wikidataId =
    currentPlace.value?.tags.wikidata ||
    currentPlace.value?.tags['brand:wikidata']
  if (!wikidataId) return

  imageLoading.value = true
  imageError.value = false
  placeImage.value = null

  try {
    // Query Wikidata API for the image
    const response = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&property=P18&entity=${wikidataId}&format=json&origin=*`,
    )
    if (!response.ok) throw new Error('Failed to fetch from Wikidata')
    const data = await response.json()

    const imageFileName = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value
    if (!imageFileName) return

    // Get the actual image URL from Wikimedia Commons
    const imageUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(
      imageFileName,
    )}&prop=imageinfo&iiprop=url&format=json&origin=*`
    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) throw new Error('Failed to fetch from Wikimedia')
    const imageData = await imageResponse.json()

    const pages = imageData.query?.pages || {}
    const page = Object.values(pages)[0] as any
    const url = page?.imageinfo?.[0]?.url
    if (!url) throw new Error('No image URL found')

    placeImage.value = url
  } catch (error) {
    console.error('Failed to fetch Wikidata image:', error)
    imageError.value = true
  } finally {
    imageLoading.value = false
  }
}

async function fetchWikidataBrandLogo() {
  const wikidataId =
    currentPlace.value?.tags.wikidata ||
    currentPlace.value?.tags['brand:wikidata']
  if (!wikidataId) return

  logoLoading.value = true
  logoError.value = false
  brandLogo.value = null

  try {
    // First get the entity data to find the logo
    const response = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidataId}&format=json&origin=*`,
    )
    if (!response.ok) throw new Error('Failed to fetch from Wikidata')
    const data = await response.json()

    const logoFileName =
      data.entities?.[wikidataId]?.claims?.P154?.[0]?.mainsnak?.datavalue?.value
    if (!logoFileName) return

    // Get the actual image URL from Wikimedia Commons
    const imageUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(
      logoFileName,
    )}&prop=imageinfo&iiprop=url&format=json&origin=*`
    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) throw new Error('Failed to fetch from Wikimedia')
    const imageData = await imageResponse.json()

    const pages = imageData.query?.pages || {}
    const page = Object.values(pages)[0] as any
    const url = page?.imageinfo?.[0]?.url
    if (!url) throw new Error('No logo URL found')

    brandLogo.value = url
  } catch (error) {
    console.error('Failed to fetch Wikidata logo:', error)
    logoError.value = true
  } finally {
    logoLoading.value = false
  }
}

function handlePlaceImageLoad() {
  placeImageLoaded.value = true
}

function handleBrandLogoLoad() {
  brandLogoLoaded.value = true
}

async function loadPlace(type: string, id: string) {
  clearPlace()
  placeImage.value = null
  brandLogo.value = null
  placeImageLoaded.value = false
  brandLogoLoaded.value = false

  const place = await fetchPlaceDetails(id, type as any)

  // Add marker when place loads
  if (place) {
    // For ways/relations, use center point
    // For nodes, use exact coordinates
    const lat = place.center?.lat ?? place.lat
    const lon = place.center?.lon ?? place.lon

    if (lat && lon) {
      removeAllMarkers()
      addMarker(MarkerIds.SELECTED_POI, { lng: lon, lat })
    }
  }

  await Promise.all([fetchWikidataImage(), fetchWikidataBrandLogo()])
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

watch(
  () => currentPlace.value,
  place => {
    // Remove the flyTo code since we now do it on click
  },
)

function formatOpeningHours(hours: string) {
  return hours.split(';').join('\n')
}

function formatCoordinates(lat: number, lon: number) {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
}

// Clean up marker when component unmounts
onUnmounted(() => {
  removeAllMarkers()
})
</script>

<template>
  <div
    class="bg-background max-h-full overflow-y-auto shadow-md flex flex-col rounded-md w-[400px]"
  >
    <div v-if="loading" class="p-4 flex items-center justify-center py-8">
      <Spinner class="w-6 h-6" />
    </div>

    <div v-else-if="error" class="p-4 text-destructive">
      {{ error }}
    </div>

    <template v-else-if="currentPlace">
      <!-- Header with full-bleed image -->
      <div class="flex flex-col">
        <TransitionExpand>
          <div
            v-if="imageLoading || placeImage || imageError"
            class="w-full relative aspect-video"
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
                  :alt="currentPlace.tags.name"
                  class="w-full h-full object-cover"
                  @load="handlePlaceImageLoad"
                />
              </transition>
            </div>
            <div
              v-if="imageError"
              class="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
            >
              Failed to load image
            </div>

            <!-- Brand Logo -->
            <div
              v-if="logoLoading || brandLogo || logoError"
              class="absolute bottom-4 left-4 size-20 rounded-lg overflow-hidden border-2 border-border shadow-lg"
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
                    :alt="currentPlace.tags.name + ' logo'"
                    class="w-full h-full object-contain bg-white"
                    @load="handleBrandLogoLoad"
                  />
                </transition>
              </div>
              <div
                v-if="logoError"
                class="w-full h-full flex items-center justify-center bg-muted"
              />
            </div>
          </div>
        </TransitionExpand>
      </div>

      <!-- All other content in padded container -->
      <div class="p-4 flex flex-col gap-4">
        <!-- Name and type -->
        <div>
          <h1 v-if="currentPlace.tags.name" class="text-2xl font-semibold">
            {{ currentPlace.tags.name }}
          </h1>
          <p class="text-muted-foreground">
            {{ placeType }}
          </p>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-2">
          <Button variant="outline" class="flex-1">
            <NavigationIcon class="mr-2 h-4 w-4" />
            Directions
          </Button>
          <Button variant="outline" class="flex-1">
            <ShareIcon class="mr-2 h-4 w-4" />
            Share
          </Button>
        </div>

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
            v-if="
              currentPlace.tags['addr:street'] ||
              currentPlace.tags['addr:housenumber'] ||
              currentPlace.tags['addr:city'] ||
              currentPlace.tags['addr:postcode']
            "
            class="flex gap-3 items-center group"
          >
            <MapPinIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1 py-1">
              <span>
                {{ currentPlace.tags['addr:housenumber'] }}
                {{ currentPlace.tags['addr:street'] }}
              </span>
              <span
                v-if="
                  currentPlace.tags['addr:city'] ||
                  currentPlace.tags['addr:state'] ||
                  currentPlace.tags['addr:postcode']
                "
                class="text-muted-foreground text-sm"
              >
                {{ currentPlace.tags['addr:city']
                }}{{
                  currentPlace.tags['addr:city'] &&
                  currentPlace.tags['addr:state']
                    ? ','
                    : ''
                }}
                {{ currentPlace.tags['addr:state'] }}
                {{ currentPlace.tags['addr:postcode'] }}
              </span>
              <span
                v-if="currentPlace.tags['addr:country']"
                class="text-muted-foreground text-sm"
              >
                {{ currentPlace.tags['addr:country'] }}
              </span>
            </div>
            <CopyButton
              :text="formattedAddress"
              message="Address copied to clipboard"
            />
          </div>

          <!-- Opening Hours -->
          <div
            v-if="currentPlace.tags.opening_hours"
            class="flex gap-3 items-center group"
          >
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
                >{{ formatOpeningHours(currentPlace.tags.opening_hours) }}</pre
              >
            </div>
          </div>

          <!-- Phone -->
          <div
            v-if="currentPlace.tags.phone"
            class="flex gap-3 items-center group"
          >
            <PhoneIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1">
              <a
                :href="`tel:${currentPlace.tags.phone}`"
                class="text-primary hover:underline"
              >
                {{ currentPlace.tags.phone }}
              </a>
            </div>
            <CopyButton
              :text="currentPlace.tags.phone"
              message="Phone number copied to clipboard"
              class="opacity-0 group-hover:opacity-100"
            />
          </div>

          <!-- Website -->
          <div v-if="currentPlace.tags.website" class="flex gap-3 items-center">
            <LinkIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <a
              :href="currentPlace.tags.website"
              target="_blank"
              rel="noopener noreferrer"
              class="text-primary hover:underline truncate"
            >
              {{ currentPlace.tags.website }}
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
          <div v-if="hasOutdoorSeating" class="flex gap-3 items-center">
            <TreesIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <span>Has outdoor seating</span>
          </div>

          <!-- Wheelchair Access -->
          <div
            v-if="currentPlace.tags.wheelchair"
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
          <div v-if="currentPlace.tags.smoking" class="flex gap-3 items-center">
            <CigaretteIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <span>
              {{ smokingStatusText }}
            </span>
          </div>

          <!-- Restrooms -->
          <div v-if="currentPlace.tags.toilets" class="flex gap-3 items-center">
            <ToiletIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col">
              <span>{{ restroomAccessText }}</span>
              <span
                v-if="currentPlace.tags['toilets:wheelchair']"
                class="text-sm text-muted-foreground"
              >
                Wheelchair
                {{
                  currentPlace.tags['toilets:wheelchair'] === 'yes'
                    ? 'accessible'
                    : 'not accessible'
                }}
              </span>
            </div>
          </div>

          <!-- Email -->
          <div
            v-if="currentPlace.tags['contact:email']"
            class="flex gap-3 items-center group"
          >
            <MailIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <a
              :href="`mailto:${currentPlace.tags['contact:email']}`"
              class="text-primary hover:underline truncate"
            >
              {{ currentPlace.tags['contact:email'] }}
            </a>
            <CopyButton
              :text="currentPlace.tags['contact:email']"
              message="Email copied to clipboard"
              class="opacity-0 group-hover:opacity-100"
            />
          </div>

          <!-- Coordinates -->
          <div v-if="coordinates" class="flex gap-3 items-center group">
            <GlobeIcon class="size-4 text-muted-foreground flex-shrink-0" />
            <div class="flex flex-col flex-1">
              <span class="text-sm">
                {{ formatCoordinates(coordinates.lat, coordinates.lon) }}
              </span>
            </div>
            <CopyButton
              :text="formatCoordinates(coordinates.lat, coordinates.lon)"
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
          <!-- OSM Info -->
          <div class="border border-border rounded-lg overflow-hidden">
            <div class="pl-3 pr-1 py-1 flex flex-col">
              <div class="flex items-center justify-between">
                <div class="flex-1">
                  <div class="flex items-center justify-between">
                    <button
                      @click="showTags = !showTags"
                      class="flex-1 flex items-center justify-between"
                    >
                      <div class="div flex flex-col items-start">
                        <span class="text-sm">OpenStreetMap</span>
                        <span class="text-xs text-muted-foreground text-start">
                          #{{ currentPlace.version }} last edited by
                          {{ currentPlace.user }}
                        </span>
                      </div>
                      <ChevronDownIcon
                        class="size-4 text-muted-foreground transition-transform"
                        :class="{ 'rotate-180': showTags }"
                      />
                    </button>
                    <Button variant="ghost" size="icon" class="ml-2" asChild>
                      <a
                        :href="osmUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View on OpenStreetMap"
                      >
                        <ExternalLinkIcon class="size-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div v-show="showTags">
              <Table>
                <TableBody>
                  <TableRow
                    v-for="[key, value] in Object.entries(currentPlace.tags)"
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
