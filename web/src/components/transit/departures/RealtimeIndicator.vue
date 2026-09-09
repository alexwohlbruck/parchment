<script setup lang="ts">
/**
 * "This time is a live prediction, not the timetable." Deliberately just an
 * icon: it answers where the number came from, not whether the vehicle is
 * running late. Pass `delay` to append how far off schedule it is — a caller
 * that already shows the scheduled time elsewhere should leave it off rather
 * than saying the same thing twice.
 */
import { computed } from 'vue'
import { WifiIcon } from 'lucide-vue-next'

interface Props {
  realTime: boolean
  delay?: number // seconds, signed (+late / -early)
  color?: string // CSS color (e.g. "#4CAF50")
}

const props = withDefaults(defineProps<Props>(), {
  color: undefined,
  delay: undefined,
})

/** Under a minute off is timetable noise, not news. */
const DELAY_NOTICE_SEC = 60

const delayLabel = computed(() => {
  const delay = props.delay
  if (delay == null || Math.abs(delay) < DELAY_NOTICE_SEC) return null
  const mins = Math.round(Math.abs(delay) / 60)
  return delay > 0 ? `${mins} min late` : `${mins} min early`
})

const isLate = computed(() => (props.delay ?? 0) >= DELAY_NOTICE_SEC)
</script>

<template>
  <span v-if="realTime" class="inline-flex items-center gap-1">
    <WifiIcon
      class="size-3 shrink-0 rotate-45"
      :style="color ? { color } : undefined"
      :class="!color && 'text-muted-foreground'"
    />
    <span
      v-if="delayLabel"
      class="text-[10px] font-medium leading-none whitespace-nowrap"
      :class="isLate ? 'text-red-600 dark:text-red-400' : 'text-sky-600 dark:text-sky-400'"
    >{{ delayLabel }}</span>
  </span>
</template>
