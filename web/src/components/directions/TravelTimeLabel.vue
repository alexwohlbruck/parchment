<script setup lang="ts">
import { formatDurationParts } from '@/lib/time-format'
import type { TravelTime } from '@/lib/directions/mode-estimates'

defineProps<{ time: TravelTime }>()
</script>

<template>
  <span class="flex h-4 items-center text-xs font-medium leading-none tabular-nums whitespace-nowrap">
    <span v-if="time.state === 'ready'">
      <template v-for="(part, i) in formatDurationParts(time.seconds).parts" :key="i">
        <span v-if="i > 0" class="inline-block w-0.5" />{{ part.value }}<span class="text-[10px] ml-px">{{ part.unit }}</span>
      </template>
    </span>
    <span v-else-if="time.state === 'loading'" class="h-1.5 w-6 rounded-full bg-current opacity-15 animate-pulse" />
  </span>
</template>
