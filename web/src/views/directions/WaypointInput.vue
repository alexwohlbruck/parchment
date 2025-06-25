<script setup lang="ts">
import draggable from 'vuedraggable'
import { computed, ref, watch } from 'vue'
import { XIcon, PlusIcon } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Waypoint } from '@/types/map.types'
import { useDirectionsService } from '@/services/directions.service'
import { TransitionSlide } from '@morev/vue-transitions'
import WaypointIcon from './WaypointIcon.vue'

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

function clearWaypoint(index: number) {
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
  if (waypoint.lngLat) {
    return `${waypoint.lngLat.lat.toFixed(5)}, ${waypoint.lngLat.lng.toFixed(
      5,
    )}`
  }
  return ''
}
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
        class="relative w-full max-w-sm items-center flex gap-2 locations-list-item group"
      >
        <!-- Waypoint circle with icons/numbers -->
        <WaypointIcon :index="index" :total-waypoints="waypoints.length" />

        <Input
          :placeholder="
            index == 0 ? $t('directions.from') : $t('directions.to')
          "
          :model-value="getWaypointName(element)"
        />
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
