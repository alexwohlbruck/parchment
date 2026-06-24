<script setup lang="ts">
import draggable from 'vuedraggable'
import { computed, ref, watch, onMounted } from 'vue'
import { XIcon, PlusIcon, Check, LocateFixedIcon, ArrowUpDownIcon, GripVerticalIcon, ClockIcon, EllipsisVerticalIcon } from 'lucide-vue-next'
import WaypointTimePopover from './WaypointTimePopover.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Waypoint, type WaypointTimeConstraint } from '@/types/map.types'
import { useDirectionsService } from '@/services/directions.service'
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
import { cn, useResponsive } from '@/lib/utils'
import { useDebounceFn } from '@vueuse/core'
import { Spinner } from '@/components/ui/spinner'
import { getSearchResultName } from '@/lib/search.utils'
import { useGeolocationService } from '@/services/geolocation.service'
import { useI18n } from 'vue-i18n'
import { ItemIcon } from '@/components/ui/item-icon'
import { type ThemeColor, fuzzyFilter } from '@/lib/utils'

const searchService = useSearchService()
const mapCamera = useMapCamera()
const { coords, isSupported: isGeolocationSupported, resume } = useGeolocationService()
const { t } = useI18n()

const directionsService = useDirectionsService()
const { isMobileScreen } = useResponsive()

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
const blurPhase = ref<Record<number, 'out' | 'wipe'>>({})

const BLUR_OUT_MS = 200
const SWAP_AT_MS = 100 // swap text while blur-out is still fading
const WIPE_IN_MS = 1300

function triggerTextSwap(index: number, newText: string) {
  // Phase 1: blur out old text on the input
  blurPhase.value[index] = 'out'

  setTimeout(() => {
    // Swap text mid-blur and start wipe — overlaps with tail of blur-out
    inputTexts.value[index] = newText
    blurPhase.value[index] = 'wipe'

    setTimeout(() => {
      delete blurPhase.value[index]
    }, WIPE_IN_MS)
  }, SWAP_AT_MS)
}

watch(
  () => waypoints.value,
  newWaypoints => {
    inputTexts.value.length = newWaypoints.length

    newWaypoints.forEach((waypoint, index) => {
      // Only update input text if user hasn't manually modified it
      if (!userModifiedInputs.value.has(index)) {
        const newText = getWaypointName(waypoint)
        const oldText = inputTexts.value[index] || ''
        // Animate blur swap only when resolving a name from coordinates
        const isCoordText = /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(oldText)
        if (newText && newText !== oldText && isCoordText) {
          triggerTextSwap(index, newText)
        } else {
          inputTexts.value[index] = newText
        }
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
  emit('update:modelValue', [...waypoints.value, { lngLat: null }])
}

/** Index of waypoint whose time popover should open (triggered from mobile menu). */
const openTimePopoverIndex = ref<number | null>(null)

function updateTimeConstraint(index: number, constraint: WaypointTimeConstraint | null) {
  const updated = [...waypoints.value]
  updated[index] = { ...updated[index], timeConstraint: constraint }
  emit('update:modelValue', updated)
}

function getWaypointName(waypoint: Waypoint) {
  if (waypoint.place) {
    const placeName = getSearchResultName(waypoint.place as Place)
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

    autocompleteResults.value = await searchService.getAutocompleteSuggestions({
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
    } as unknown as Place // TODO: Fix this
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
        iconColor: result.color || 'magenta',
      },
    } as unknown as Place
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
  } as unknown as Place
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

const swapRotations = ref<Record<number, number>>({})

function swapAdjacentWaypoints(index: number) {
  swapRotations.value[index] = (swapRotations.value[index] || 0) + 180
  const newWaypoints = [...waypoints.value]
  ;[newWaypoints[index], newWaypoints[index + 1]] = [newWaypoints[index + 1], newWaypoints[index]]
  emit('update:modelValue', newWaypoints)
  const newTexts = [...inputTexts.value]
  ;[newTexts[index], newTexts[index + 1]] = [newTexts[index + 1], newTexts[index]]
  inputTexts.value = newTexts
}

function locateUser(index: number) {
  if (!isGeolocationSupported.value || !coords.value.latitude || !coords.value.longitude) return
  const result = createCurrentLocationResult()
  if (result) {
    selectPlace(index, autocompleteResultToPlace(result), result)
  }
}

defineExpose({
  clearWaypoint,
})
</script>

<template>
  <div class="relative flex flex-col gap-2">
    <draggable
      v-model="waypoints"
      :animation="200"
      handle=".handle"
      tag="div"
      class="relative flex flex-col gap-2"
    >
      <template #item="{ element, index }">
        <div class="relative flex items-center group">
          <div class="flex-1 relative">
            <!-- Connecting line between icons -->
            <div
              v-if="index < waypoints.length - 1"
              class="absolute left-[1.19rem] top-full w-px h-2 bg-border z-0"
            />

            <Combobox
              class="flex-1"
              ignore-filter
              :reset-search-term-on-select="false"
              :reset-search-term-on-blur="false"
            >
              <ComboboxAnchor>
                <ComboboxInput
                  :placeholder="index === 0 ? $t('directions.from') : $t('directions.to')"
                  :model-value="inputTexts[index] || ''"
                  :class="blurPhase[index] === 'out' ? 'animate-blur-out' : blurPhase[index] === 'wipe' ? 'animate-wipe-in' : ''"
                  hide-search-icon
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
                >
                  <template #prefix>
                    <div class="shrink-0 flex items-center justify-center handle cursor-grab active:cursor-grabbing relative">
                      <div
                        class="size-4 rounded-full flex items-center justify-center group-hover:opacity-0 transition-opacity"
                        :class="index === 0 ? 'bg-background border-[1.5px] border-foreground/60' : 'bg-primary border-[1.5px] border-white'"
                      >
                        <span v-if="index > 0" class="text-[9px] font-bold text-white">{{ index }}</span>
                      </div>
                      <GripVerticalIcon class="size-4 text-muted-foreground absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </template>
                  <template #postfix>
                    <!-- Desktop: icon buttons hidden until row hover -->
                    <div v-if="!isMobileScreen" class="flex items-center -mr-1.5">
                      <!-- Active time badge stays visible without hover -->
                      <WaypointTimePopover
                        v-if="element.lngLat || element.timeConstraint"
                        :model-value="element.timeConstraint"
                        :index="index"
                        :waypoint-count="waypoints.length"
                        :prev-constraint="index > 0 ? waypoints[index - 1]?.timeConstraint : null"
                        :next-constraint="index < waypoints.length - 1 ? waypoints[index + 1]?.timeConstraint : null"
                        :class="element.timeConstraint ? '' : 'opacity-0 group-hover:opacity-100 transition-opacity'"
                        @update:model-value="c => updateTimeConstraint(index, c)"
                      />
                      <Button
                        v-if="!inputTexts[index]"
                        @click="locateUser(index)"
                        variant="ghost"
                        size="icon"
                        class="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        :title="$t('directions.currentLocation')"
                      >
                        <LocateFixedIcon class="size-4" />
                      </Button>
                      <Button
                        @click="clearWaypoint(index)"
                        variant="ghost"
                        size="icon"
                        class="size-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <XIcon class="size-4" />
                      </Button>
                    </div>

                    <!-- Mobile: consolidated dropdown menu, always visible -->
                    <div v-else class="flex items-center -mr-1.5">
                      <!-- Time popover (rendered but trigger hidden — opened programmatically from menu) -->
                      <WaypointTimePopover
                        v-if="element.lngLat || element.timeConstraint"
                        :model-value="element.timeConstraint"
                        :index="index"
                        :waypoint-count="waypoints.length"
                        :prev-constraint="index > 0 ? waypoints[index - 1]?.timeConstraint : null"
                        :next-constraint="index < waypoints.length - 1 ? waypoints[index + 1]?.timeConstraint : null"
                        :open="openTimePopoverIndex === index"
                        @update:open="v => { if (!v) openTimePopoverIndex = null }"
                        @update:model-value="c => updateTimeConstraint(index, c)"
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger as-child>
                          <Button
                            variant="ghost"
                            size="icon"
                            class="size-7"
                          >
                            <EllipsisVerticalIcon class="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" class="w-44">
                          <DropdownMenuItem
                            v-if="element.lngLat || element.timeConstraint"
                            @click="openTimePopoverIndex = index"
                          >
                            <ClockIcon class="size-4 mr-2" />
                            {{ element.timeConstraint ? 'Edit time' : 'Set time' }}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            v-if="!inputTexts[index]"
                            @click="locateUser(index)"
                          >
                            <LocateFixedIcon class="size-4 mr-2" />
                            {{ $t('directions.currentLocation') }}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator v-if="element.lngLat || !inputTexts[index]" />
                          <DropdownMenuItem @click="clearWaypoint(index)">
                            <XIcon class="size-4 mr-2" />
                            Clear
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </template>
                </ComboboxInput>
              </ComboboxAnchor>

              <ComboboxList>
                <div
                  v-if="isLoading && combinedResults.length === 0"
                  class="flex items-center justify-center p-4"
                >
                  <Spinner class="h-4 w-4" />
                </div>

                <ComboboxEmpty v-else-if="!isLoading && combinedResults.length === 0">
                  No results found.
                </ComboboxEmpty>

                <ComboboxGroup v-if="!isLoading || combinedResults.length > 0">
                  <ComboboxItem
                    v-for="result in combinedResults"
                    :key="result.id"
                    :value="autocompleteResultToPlace(result)"
                    @select="selectPlace(index, autocompleteResultToPlace(result), result)"
                  >
                    <div class="flex items-center gap-2 flex-1">
                      <ItemIcon
                        :icon="
                          result.type === 'current_location'
                            ? 'Locate'
                            : result.type === 'bookmark'
                              ? result.icon || 'MapPin'
                              : 'MapPin'
                        "
                        :color="(result.color as ThemeColor) || 'parchment'"
                        size="sm"
                        class="size-4"
                      />
                      <div class="flex flex-col flex-1">
                        <span>{{ result.title }}</span>
                        <span v-if="result.description" class="text-sm text-muted-foreground">
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

          </div>

          <!-- Swap button between adjacent inputs -->
          <Button
            v-if="index < waypoints.length - 1"
            variant="outline"
            size="icon-sm"
            class="absolute -bottom-4 left-8 z-10 rounded-full size-7 bg-background shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
            @click.stop="swapAdjacentWaypoints(index)"
            title="Swap"
          >
            <ArrowUpDownIcon class="size-3.5 transition-transform duration-300" :style="{ transform: `rotate(${swapRotations[index] || 0}deg)` }" />
          </Button>
        </div>
      </template>
    </draggable>
  </div>

  <div class="-mt-1">
    <Button
      variant="outline"
      :icon="PlusIcon"
      @click="addWaypoint()"
      class="w-full h-10"
    >
      {{ $t('directions.addStop') }}
    </Button>
  </div>
</template>
