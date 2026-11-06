<script setup lang="ts">
import { getModeIcon } from '@/lib/directions/travel-mode-icons'
import { getTravelModeColor } from '@/lib/directions/travel-mode-colors'

defineProps<{ tip: { text: string; iconMode: string } }>()
</script>

<template>
  <div class="mx-3 mb-1 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground tabular-nums">
    <component :is="getModeIcon(tip.iconMode)" class="size-3.5 shrink-0" :style="{ color: getTravelModeColor(tip.iconMode) }" />
    {{ tip.text }}
  </div>
</template>
