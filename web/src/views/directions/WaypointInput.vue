<script setup lang="ts">
import draggable from 'vuedraggable'
import { computed } from 'vue'
import { XIcon, PlusIcon, GripHorizontalIcon } from 'lucide-vue-next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const MIN_LOCATIONS = 2

const props = defineProps<{
  modelValue: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  change: []
}>()

const waypoints = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

function clearWaypoint(index: number) {
  if (waypoints.value.length > MIN_LOCATIONS) {
    const newWaypoints = [...waypoints.value]
    newWaypoints.splice(index, 1)
    waypoints.value = newWaypoints
    emit('change')
  } else {
    const newWaypoints = [...waypoints.value]
    newWaypoints[index] = ''
    waypoints.value = newWaypoints
  }
}

function addWaypoint() {
  waypoints.value = [...waypoints.value, '']
}

function onDragEnd() {
  emit('change')
}
</script>

<template>
  <draggable
    v-model="waypoints"
    :animation="200"
    handle=".handle"
    item-key="index"
    @end="onDragEnd"
    tag="transition-group"
    :component-data="{
      name: 'locations-list',
      type: 'transition-group',
    }"
    class="flex flex-col gap-2"
  >
    <template #item="{ element, index }">
      <div
        class="relative w-full max-w-sm items-center flex gap-2 locations-list-item"
      >
        <GripHorizontalIcon class="size-4 cursor-move handle" />
        <Input
          :placeholder="index == 0 ? 'From' : 'To'"
          :value="element"
          @input="e => waypoints[index] = (e.target as HTMLInputElement).value"
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
    Add stop
  </Button>
</template>
