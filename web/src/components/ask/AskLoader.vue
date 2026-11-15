<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

defineProps<{ label: string; startedAt: number }>()

const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 100)
onBeforeUnmount(() => clearInterval(timer))

/** Order the 3×3 grid lights in: a sweep that reads as "driving forward". */
const DELAYS = [0, 1, 2, 1, 2, 3, 2, 3, 4]
</script>

<template>
  <div class="flex items-center gap-2.5 text-[13px]" role="status" aria-live="polite">
    <span class="grid grid-cols-3 gap-px size-3 shrink-0" aria-hidden="true">
      <span
        v-for="(delay, i) in DELAYS"
        :key="i"
        class="size-[3px] rounded-[1px] bg-foreground animate-[pixel-pulse_1.1s_ease-in-out_infinite]"
        :style="{ animationDelay: `${delay * 110}ms` }"
      />
    </span>
    <span
      class="font-medium bg-[linear-gradient(90deg,var(--color-muted-foreground)_35%,var(--color-foreground)_50%,var(--color-muted-foreground)_65%)] bg-size-[200%_100%] bg-clip-text text-transparent animate-[text-shimmer_2.2s_linear_infinite]"
    >
      {{ label }}
    </span>
    <span class="font-mono text-[11px] text-muted-foreground tabular-nums">
      {{ ((now - startedAt) / 1000).toFixed(1) }}s
    </span>
  </div>
</template>
