<script setup lang="ts">
import draggable from 'vuedraggable'
import { computed, ref, watch, onMounted } from 'vue'
import { XIcon, PlusIcon, Check } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Waypoint } from '@/types/map.types'
import { useDirectionsService } from '@/services/directions.service'
import WaypointIcon from './WaypointIcon.vue'
import {
  Combobox,
  ComboboxInput,
  ComboboxList,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxAnchor,
} from '@/components/ui/combobox'
import { Place } from '@/types/place.types'
import { AutocompleteResult } from '@/types/search.types'
import { useSearchService } from '@/services/search.service'
import { useMapCamera } from '@/composables/useMapCamera'
import { cn } from '@/lib/utils'
import { useDebounceFn } from '@vueuse/core'
import { Spinner } from '@/components/ui/spinner'
import { getSearchResultName } from '@/lib/search.utils'
import { useGeolocation } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { ItemIcon } from '@/components/ui/item-icon'
import { type ThemeColor, fuzzyFilter } from '@/lib/utils'

const searchService = useSearchService()
const mapCamera = useMapCamera()
const { coords, isSupported: isGeolocationSupported, resume } = useGeolocation()
const { t } = useI18n()

const directionsService = useDirectionsService()

const MIN_LOCATIONS = 2

const props = defineProps<{
  modelValue: Waypoint[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Waypoint[]]
}>()

const waypoints = computed({
  get: () => props.modelValue,
  set: newValue => {
    emit('update:modelValue', newValue)
  },
})

const inputTexts = ref<string[]>([])
const userModifiedInputs = ref<Set<number>>(new Set())

watch(
  () => waypoints.value,
  newWaypoints => {
    inputTexts.value.length = newWaypoints.length

    newWaypoints.forEach((waypoint, index) => {
      // Only update input text if user hasn't manually modified it
      if (!userModifiedInputs.value.has(index)) {
        const newText = getWaypointName(waypoint)
        inputTexts.value[index] = newText
      }
    })
  },
  { immediate: true, deep: true },
)

function clearWaypoint(index: number) {
  // Clear the input text
  inputTexts.value[index] = ''
  
  // Clear user-modified flag
  userModifiedInputs.value.delete(index)

  if (waypoints.value.length > MIN_LOCATIONS) {
    const newWaypoints = [...waypoints.value]
    newWaypoints.splice(index, 1)

    // Remove the corresponding input text
    inputTexts.value.splice(index, 1)
    
    // Update user-modified flags for remaining inputs
    const newUserModified = new Set<number>()
    userModifiedInputs.value.forEach(i => {
      if (i < index) {
        newUserModified.add(i)
      } else if (i > index) {
        newUserModified.add(i - 1)
      }
    })
    userModifiedInputs.value = newUserModified

    emit('update:modelValue', newWaypoints)
  } else {
    const newWaypoints = [...waypoints.value]
    newWaypoints[index] = { lngLat: null }
    emit('update:modelValue', newWaypoints)
  }
}

function addWaypoint() {
  inputTexts.value.push('')
  emit('update:modelValue', [
    ...waypoints.value,
    { lngLat: null },
  ])
}

function getWaypointName(waypoint: Waypoint) {
  if (waypoint.place) {
    const placeName = getSearchResultName(waypoint.place)
    // If place exists but has no name, fall back to coordinates
    if (placeName) {
      return placeName
    }
  }
  if (waypoint.lngLat) {
    // Show coordinates as fallback if no place name available
    return `${waypoint.lngLat.lat.toFixed(5)}, ${waypoint.lngLat.lng.toFixed(
      5,
    )}`
  }
  return ''
}

function selectPlace(index: number, place: Place, result?: AutocompleteResult) {
  const newWaypoints = [...waypoints.value]

  // Create waypoint with place and coordinates - all place types follow the same pattern
  newWaypoints[index] = {
    ...newWaypoints[index],
    place: place,
    lngLat: {
      lat: place.geometry.value.center.lat,
      lng: place.geometry.value.center.lng,
    },
  }

  emit('update:modelValue', newWaypoints)

  // Update input text to show the selected place name
  inputTexts.value[index] = result ? result.title : getSearchResultName(place)
  
  // Clear user-modified flag since we're setting a system value
  userModifiedInputs.value.delete(index)
}

const autocompleteResults = ref<AutocompleteResult[]>([])
const isLoading = ref(false)
const currentQuery = ref('')

// Combined results with current location prepended if not already used and matches query
const combinedResults = computed(() => {
  const results = [...autocompleteResults.value]

  // Only add current location if it's not already used AND (query is empty OR fuzzy matches)
  if (!isCurrentLocationUsed.value) {
    const currentLocationResult = createCurrentLocationResult()
    if (currentLocationResult) {
      // Show current location if query is empty or if it fuzzy matches the query
      if (!currentQuery.value.trim()) {
        // Empty query - always show current location
        results.unshift(currentLocationResult)
      } else {
        // Non-empty query - check if it fuzzy matches current location
        const matches = fuzzyFilter(
          [currentLocationResult],
          currentQuery.value,
          {
            keys: ['title', 'description'],
            threshold: -10000, // Lower threshold to be more permissive
          },
        )
        if (matches.length > 0) {
          results.unshift(currentLocationResult)
        }
      }
    }
  }

  return results
})

const getAutocomplete = useDebounceFn(async (index: number, value: string) => {
  currentQuery.value = value
  isLoading.value = true
  try {
    const { camera } = mapCamera
    const center = camera.value.center

    // Extract coordinates from various center formats
    const [lng, lat] = Array.isArray(center)
      ? center
      : 'lng' in center
      ? [center.lng, center.lat]
      : [center.lon, center.lat]

    autocompleteResults.value =
      await searchService.getAutocompleteSuggestions({
        query: value,
        lat,
        lng,
      })
  } finally {
    isLoading.value = false
  }
}, 200)

// Convert AutocompleteResult to Place object
function autocompleteResultToPlace(result: AutocompleteResult): Place {
  if (result.type === 'current_location') {
    return {
      id: 'current-location',
      name: { value: result.title },
      geometry: {
        value: {
          type: 'point',
          center: {
            lat: result.lat,
            lng: result.lng,
          },
        },
      },
      externalIds: {},
      address: null,
      placeType: { value: 'current_location' },
    } as Place
  }

  if (result.type === 'bookmark') {
    return {
      id: result.id,
      name: { value: result.title },
      geometry: {
        value: {
          type: 'point',
          center: {
            lat: result.lat,
            lng: result.lng,
          },
        },
      },
      externalIds: {},
      address: result.description
        ? { value: { formatted: result.description } }
        : null,
      placeType: { value: 'bookmark' },
      bookmark: {
        id: result.id,
        name: result.title,
        icon: result.icon || 'map-pin',
        iconColor: result.color || 'rose',
      },
    } as Place
  }

  // Default for 'place' type and fallback
  return {
    id: result.id,
    name: { value: result.title },
    geometry: {
      value: {
        type: 'point',
        center: {
          lat: result.lat,
          lng: result.lng,
        },
      },
    },
    externalIds: {},
    address: result.description
      ? { value: { formatted: result.description } }
      : null,
    placeType: { value: 'place' },
  } as Place
}

// Check if current location is already used in any waypoint that hasn't been edited
const isCurrentLocationUsed = computed(() => {
  return waypoints.value.some((waypoint, index) => {
    // Current location is considered "used" only if:
    // 1. The waypoint has current location as its place
    // 2. The input text matches the current location name (user hasn't started editing)
    if (waypoint.place?.id === 'current-location') {
      const currentLocationName = t(
        'directions.currentLocation',
        'Current Location',
      )
      const inputText = inputTexts.value[index] || ''
      return inputText === currentLocationName
    }
    return false
  })
})

// Create current location autocomplete result
const createCurrentLocationResult = (): AutocompleteResult | null => {
  if (
    !isGeolocationSupported.value ||
    !coords.value.latitude ||
    !coords.value.longitude ||
    coords.value.latitude === Infinity ||
    coords.value.longitude === Infinity
  ) {
    return null
  }

  return {
    id: 'current-location',
    type: 'current_location',
    title: t('directions.currentLocation', 'Current Location'),
    description: t(
      'directions.useCurrentLocation',
      'Use your current location',
    ),
    lat: coords.value.latitude,
    lng: coords.value.longitude,
  }
}

onMounted(() => {
  // Request geolocation permissions early so current location is available
  if (isGeolocationSupported.value) {
    resume()
  }
})

defineExpose({
  clearWaypoint,
})
</script>

<template>
  <draggable
    v-model="waypoints"
    :animation="200"
    handle=".handle"
    tag="div"
    class="flex flex-col gap-2"
  >
    <template #item="{ element, index }">
      <div
        class="relative w-full items-center flex gap-2 locations-list-item group"
      >
        <!-- Waypoint circle with icons/numbers -->
        <WaypointIcon :index="index" :total-waypoints="waypoints.length" />

        <Combobox
          class="flex-1"
          ignore-filter
          :reset-search-term-on-select="false"
          :reset-search-term-on-blur="false"
        >
          <ComboboxAnchor>
            <ComboboxInput
              :placeholder="
                index == 0 ? $t('directions.from') : $t('directions.to')
              "
              :model-value="inputTexts[index] || ''"
              @update:model-value="
                value => {
                  inputTexts[index] = value
                  userModifiedInputs.add(index)
                  getAutocomplete(index, value)
                }
              "
              @focus="
                () => {
                  const currentValue = inputTexts[index] || ''
                  currentQuery = currentValue
                  getAutocomplete(index, currentValue)
                }
              "
            />
          </ComboboxAnchor>

          <ComboboxList>
            <div
              v-if="isLoading && combinedResults.length === 0"
              class="flex items-center justify-center p-4"
            >
              <Spinner class="h-4 w-4" />
            </div>

            <ComboboxEmpty
              v-else-if="!isLoading && combinedResults.length === 0"
            >
              No results found.
            </ComboboxEmpty>

            <ComboboxGroup v-if="!isLoading || combinedResults.length > 0">
              <ComboboxItem
                v-for="result in combinedResults"
                :key="result.id"
                :value="autocompleteResultToPlace(result)"
                @select="
                  selectPlace(index, autocompleteResultToPlace(result), result)
                "
              >
                <div class="flex items-center gap-2 flex-1">
                  <!-- Single ItemIcon with computed icon and color -->
                  <ItemIcon
                    :icon="
                      result.type === 'current_location'
                        ? 'Locate'
                        : result.type === 'bookmark'
                        ? result.icon || 'MapPin'
                        : 'MapPin'
                    "
                    :color="(result.color as ThemeColor) || 'slate'"
                    size="sm"
                    class="size-4"
                  />
                  <div class="flex flex-col flex-1">
                    <span>{{ result.title }}</span>
                    <span
                      v-if="result.description"
                      class="text-sm text-muted-foreground"
                    >
                      {{ result.description }}
                    </span>
                  </div>
                </div>

                <ComboboxItemIndicator>
                  <Check :class="cn('ml-auto h-4 w-4')" />
                </ComboboxItemIndicator>
              </ComboboxItem>
            </ComboboxGroup>
          </ComboboxList>
        </Combobox>

        <span class="absolute end-0 inset-y-0 flex items-center justify-center">
          <Button
            @click="clearWaypoint(index)"
            variant="ghost"
            size="icon"
            :icon="XIcon"
            class="rounded-l-none"
          ></Button>
        </span>
      </div>
    </template>
  </draggable>

  <Button variant="outline" :icon="PlusIcon" @click="addWaypoint()" class="w-fit self-center">
    {{ $t('directions.addStop') }}
  </Button>
</template>
