<script setup lang="ts">
import draggable from 'vuedraggable'
import { computed, ref, watch } from 'vue'
import { XIcon, PlusIcon, GripHorizontalIcon } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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
        <Input
          :placeholder="
            index == 0
              ? $t('directions.from')
              : index == waypoints.length - 1
              ? $t('directions.to')
              : $t('directions.stop', { number: index })
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

  <Button variant="secondary" :icon="PlusIcon" @click="addWaypoint()">
    {{ $t('directions.addStop') }}
  </Button>
</template>
