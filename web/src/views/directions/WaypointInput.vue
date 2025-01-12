<script setup lang="ts">
import draggable from 'vuedraggable'
import { computed, ref, watch } from 'vue'
import { XIcon, PlusIcon, GripHorizontalIcon, TimerIcon } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import WaypointTimingInput from './WaypointTimingInput.vue'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Waypoint } from '@/types/map.types'
import { useDirectionsService } from '@/services/directions.service'

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
        class="relative w-full max-w-sm items-center flex gap-2 locations-list-item"
      >
        <GripHorizontalIcon class="size-4 cursor-move handle" />
        <div class="flex flex-1">
          <Input
            :placeholder="index == 0 ? 'From' : 'To'"
            :model-value="getWaypointName(element)"
          />
          <Popover>
            <PopoverTrigger as-child>
              <Button variant="ghost" size="icon" :icon="TimerIcon"></Button>
            </PopoverTrigger>
            <PopoverContent>
              <WaypointTimingInput />
            </PopoverContent>
          </Popover>
          <Button
            @click="clearWaypoint(index)"
            variant="ghost"
            size="icon"
            :icon="XIcon"
          ></Button>
        </div>
      </div>
    </template>
  </draggable>

  <Button variant="secondary" :icon="PlusIcon" @click="addWaypoint()">
    Add stop
  </Button>
</template>
