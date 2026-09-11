<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  src: string | null
  name: string
  size?: 'sm' | 'md'
}>()

// Brand logos come from third-party CDNs; a dead one falls back to the initial.
const failed = ref(false)
watch(() => props.src, () => { failed.value = false })
</script>

<template>
  <img
    v-if="src && !failed"
    :src="src"
    :alt="name"
    :class="size === 'sm' ? 'size-8' : 'size-10'"
    class="shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-border"
    loading="lazy"
    @error="failed = true"
  />
  <div
    v-else
    :class="size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm'"
    class="flex shrink-0 items-center justify-center rounded-md bg-muted font-medium text-muted-foreground"
  >
    {{ name.charAt(0) }}
  </div>
</template>
