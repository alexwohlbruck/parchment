<script setup lang="ts">
import { computed } from 'vue'
import { StarIcon } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    /** 0–1 normalized rating. */
    rating: number
    size?: 'sm' | 'md'
  }>(),
  { size: 'md' },
)

const filled = computed(() => Math.round(props.rating * 5))
</script>

<template>
  <div class="flex items-center gap-0.5" :aria-label="`${(rating * 5).toFixed(1)} / 5`">
    <StarIcon
      v-for="i in 5"
      :key="i"
      :class="[
        size === 'sm' ? 'size-3' : 'size-3.5',
        i <= filled
          ? 'fill-amber-400 text-amber-400'
          : 'text-muted-foreground/30',
      ]"
    />
  </div>
</template>
