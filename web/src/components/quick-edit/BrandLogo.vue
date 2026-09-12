<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  src: string | null
  name: string
  size?: 'sm' | 'md'
}>()

// Logos come from third-party CDNs. The initial shows until one arrives and
// stays if it never does, so the slot is never an empty box.
const loaded = ref(false)
const failed = ref(false)
watch(
  () => props.src,
  () => {
    loaded.value = false
    failed.value = false
  },
)

const sizeClass = computed(() =>
  props.size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm',
)
</script>

<template>
  <div
    class="relative shrink-0 overflow-hidden rounded-md"
    :class="sizeClass"
  >
    <div
      class="flex size-full items-center justify-center bg-muted font-medium text-muted-foreground"
    >
      {{ name.charAt(0) }}
    </div>
    <img
      v-if="src && !failed"
      :src="src"
      :alt="name"
      class="absolute inset-0 size-full rounded-md bg-white object-contain p-0.5 ring-1 ring-border transition-opacity"
      :class="loaded ? 'opacity-100' : 'opacity-0'"
      @load="loaded = true"
      @error="failed = true"
    />
  </div>
</template>
