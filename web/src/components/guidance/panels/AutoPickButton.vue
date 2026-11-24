<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{ seconds: number; running: boolean; disabled?: boolean }>()
const emit = defineEmits<{ fire: [] }>()

const left = ref(props.seconds)
let timer: ReturnType<typeof setInterval> | null = null

function clear() {
  if (timer) clearInterval(timer)
  timer = null
}

watch(
  () => props.running,
  running => {
    clear()
    if (!running) return
    left.value = props.seconds
    timer = setInterval(() => {
      left.value -= 1
      if (left.value > 0) return
      clear()
      emit('fire')
    }, 1000)
  },
  { immediate: true },
)

onBeforeUnmount(clear)
</script>

<template>
  <Button class="relative h-11 w-full gap-2 overflow-hidden rounded-full" :disabled="disabled" @click="emit('fire')">
    <span
      v-if="running"
      class="auto-pick-fill absolute inset-y-0 left-0 bg-primary-foreground/15"
      :style="{ animationDuration: `${seconds}s` }"
    />
    <span class="relative min-w-0 truncate"><slot /></span>
    <span v-if="running" class="relative tabular-nums opacity-70">{{ left }}</span>
  </Button>
</template>

<style scoped>
.auto-pick-fill {
  animation-name: auto-pick-fill;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

@keyframes auto-pick-fill {
  from { width: 0; }
  to { width: 100%; }
}
</style>
