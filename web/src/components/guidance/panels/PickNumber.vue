<script setup lang="ts">
import { computed } from 'vue'
import { usePoiBadgeColors } from '@/composables/guidance/usePoiBadgeColors'

const props = defineProps<{ n: number; category: string }>()
const badgeColors = usePoiBadgeColors()
const colors = computed(() => badgeColors.value(props.category))
</script>

<template>
  <span
    class="flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] text-xs font-bold tabular-nums"
    :style="{ background: colors.plate, color: colors.ink, borderColor: colors.ring, boxShadow: `0 1px 2px ${colors.lift}` }"
  >
    {{ n }}
  </span>
</template>
