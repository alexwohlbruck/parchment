<script setup lang="ts">
const props = defineProps<{
  index: number
  totalWaypoints: number
  type?: 'origin' | 'destination' | 'waypoint'
}>()
</script>

<template>
  <div class="relative size-8 shrink-0 cursor-move flex items-center justify-center">
    <!-- Origin: hollow circle -->
    <div
      v-if="index === 0 || type === 'origin'"
      class="size-4 rounded-full bg-background border-2 border-foreground/70 shadow-md"
    />
    <!-- Stops: primary circle with number -->
    <div
      v-else
      class="size-5 rounded-full bg-primary border-[1.5px] border-white flex items-center justify-center shadow-md"
    >
      <span class="text-[10px] font-bold text-white">{{ index }}</span>
    </div>
  </div>
</template>
