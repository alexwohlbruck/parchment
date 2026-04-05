<script setup lang="ts">
import { PencilLineIcon, CheckCircleIcon } from 'lucide-vue-next'
import type { OsmNote } from '@/types/notes.types'

const { note, isHovered } = defineProps<{
  note: OsmNote
  isHovered?: boolean
}>()

const emit = defineEmits<{
  click: [note: OsmNote, event: MouseEvent]
  mouseenter: [note: OsmNote, event: MouseEvent]
  mouseleave: [note: OsmNote, event: MouseEvent]
}>()
</script>

<template>
  <div
    class="relative"
    @click="emit('click', note, $event)"
    @mouseenter="emit('mouseenter', note, $event)"
    @mouseleave="emit('mouseleave', note, $event)"
  >
    <div
      class="size-[22px] border-[1.5px] border-white dark:border-[#0C0C0C] rounded-full flex items-center justify-center shadow-md transition-all duration-150 ease-out cursor-pointer select-none"
      :class="[
        isHovered ? 'scale-[1.3] shadow-lg' : '',
      ]"
      :style="{ backgroundColor: 'hsl(var(--primary))' }"
    >
      <PencilLineIcon class="text-white dark:text-[#0C0C0C] size-3" />
    </div>
    <CheckCircleIcon
      v-if="note.status === 'closed'"
      class="absolute -bottom-1 -right-1 size-3 text-green-500 fill-white dark:fill-[#0C0C0C] drop-shadow-sm"
    />
  </div>
</template>

<style scoped>
div {
  pointer-events: all;
}
</style>
