<script setup lang="ts">
import { computed } from 'vue'
import { WifiIcon } from 'lucide-vue-next'

interface Props {
  realTime: boolean
  delay?: number // seconds
  color?: string // CSS color (e.g. "#4CAF50")
}

const props = withDefaults(defineProps<Props>(), {
  color: undefined,
  delay: undefined,
})

const delayMinutes = computed(() => {
  if (props.delay == null) return null
  return Math.ceil(Math.abs(props.delay) / 60)
})

const delayLabel = computed(() => {
  if (delayMinutes.value == null || delayMinutes.value === 0) return null
  if (props.delay! > 0) return `+${delayMinutes.value} min`
  return `${delayMinutes.value} min early`
})

const isLate = computed(() => (props.delay ?? 0) > 0)
const isEarly = computed(() => (props.delay ?? 0) < 0)
</script>

<template>
  <span v-if="realTime" class="inline-flex items-center">
    <WifiIcon
      class="size-3 shrink-0 rotate-45"
      :style="color ? { color } : undefined"
      :class="!color && 'text-muted-foreground'"
    />
  </span>
</template>
