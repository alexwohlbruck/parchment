<script setup lang="ts">
import draggable from 'vuedraggable'
import { computed, ref, watch } from 'vue'
import { XIcon, PlusIcon, Check } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Waypoint } from '@/types/map.types'
import { useDirectionsService } from '@/services/directions.service'
import WaypointIcon from './WaypointIcon.vue'
import { Combobox, ComboboxInput, ComboboxList, ComboboxEmpty, ComboboxGroup, ComboboxItem, ComboboxItemIndicator, ComboboxAnchor } from '@/components/ui/combobox'
import { Place } from '@/types/place.types'
import { usePlaceSearchService } from '@/services/place-search.service'
import { useMapCamera } from '@/composables/useMapCamera'
import { cn } from '@/lib/utils'
import { useDebounceFn } from '@vueuse/core'
import { Spinner } from '@/components/ui/spinner'
import { formatAddress } from '@/lib/place.utils'

const placeSearchService = usePlaceSearchService()
const mapCamera = useMapCamera()

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

const userInputs = ref<Map<number, string>>(new Map())

const getInputValue = (index: number) => {
  if (userInputs.value.has(index)) {
    return userInputs.value.get(index) || ''
  }
  return getWaypointName(waypoints.value[index])
}

function clearWaypoint(index: number) {
  userInputs.value.delete(index)
  
  if (waypoints.value.length > MIN_LOCATIONS) {
    const newWaypoints = [...waypoints.value]
    newWaypoints.splice(index, 1)
    emit('update:modelValue', newWaypoints)
  } else {
    const newWaypoints = [...waypoints.value]
    newWaypoints[index] = directionsService.createBlankWaypoint()
    emit('update:modelValue', newWaypoints)
  }
}

function addWaypoint() {
  emit('update:modelValue', [
    ...waypoints.value,
    directionsService.createBlankWaypoint(),
  ])
}

function getWaypointName(waypoint: Waypoint) {
  if (waypoint.place) {
    return waypoint.place.name.value
  }
  if (waypoint.lngLat) {
    return `${waypoint.lngLat.lat.toFixed(5)}, ${waypoint.lngLat.lng.toFixed(
      5,
    )}`
  }
  return ''
}

function updateInputValue(index: number, value: string) {
  if (value.trim() === '') {
    userInputs.value.delete(index)
  } else {
    userInputs.value.set(index, value)
  }
}

function selectPlace(index: number, place: Place) {
  const newWaypoints = [...waypoints.value]
  newWaypoints[index] = {
    ...newWaypoints[index],
    place: place,
    lngLat: {
      lat: place.geometry.value.center.lat,
      lng: place.geometry.value.center.lng
    }
  }
  emit('update:modelValue', newWaypoints)
  
  userInputs.value.delete(index)
}

watch(() => waypoints.value.length, (newLength, oldLength) => {
  if (newLength < oldLength) {
    for (const [index] of userInputs.value) {
      if (index >= newLength) {
        userInputs.value.delete(index)
      }
    }
  }
})

const autocompleteResults = ref<Place[]>([])
const isLoading = ref(false)

const getAutocomplete = useDebounceFn(async (index: number, value: string) => {
  if (!value.trim()) {
    autocompleteResults.value = []
    return
  }
  
  isLoading.value = true
  try {
    const { camera } = mapCamera
    const center = camera.value.center
    const [lng, lat] = Array.isArray(center)
      ? center
      : 'lon' in center
      ? [center.lon, center.lat]
      : [center.lng, center.lat]
    autocompleteResults.value = await placeSearchService.getAutocomplete(value, lat, lng)
  } finally {
    isLoading.value = false
  }
}, 200)

defineExpose({
  clearWaypoint
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

        <Combobox class="flex-1" ignore-filter>
          <ComboboxAnchor>
            <ComboboxInput
              :placeholder="
                index == 0 ? $t('directions.from') : $t('directions.to')
              "
              :model-value="getInputValue(index)"
              @update:model-value="(value) => {
                updateInputValue(index, value)
                getAutocomplete(index, value)
              }"
            />
          </ComboboxAnchor>

          <ComboboxList>
            <div v-if="isLoading" class="flex items-center justify-center p-4">
              <Spinner class="h-4 w-4" />
            </div>
            
            <ComboboxEmpty v-else>
              No results found.
            </ComboboxEmpty>

            <ComboboxGroup v-if="!isLoading">
              <ComboboxItem
                v-for="place in autocompleteResults"
                :key="place.id"
                :value="place"
                @select="selectPlace(index, place)"
              >
                <div class="flex flex-col">
                  <span>{{ place.name.value }}</span>
                  <span v-if="place.address" class="text-sm text-muted-foreground">
                    {{ formatAddress(place) }}
                  </span>
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

  <Button variant="outline" :icon="PlusIcon" @click="addWaypoint()">
    {{ $t('directions.addStop') }}
  </Button>
</template>
