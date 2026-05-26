<script setup lang="ts">
import { computed } from 'vue'
import type { Place } from '@/types/place.types'

const props = defineProps<{
  place: Partial<Place>
}>()

const sources = computed(() => props.place.sources ?? [])
</script>

<template>
  <div
    v-if="sources.length"
    class="px-3.5 py-2.5 rounded-lg border border-border text-xs text-muted-foreground"
  >
    Data from
    <template v-for="(source, i) in sources" :key="source.id">
      <template v-if="i > 0 && i < sources.length - 1">, </template>
      <template v-if="i > 0 && i === sources.length - 1"> and </template>
      <a
        v-if="source.url"
        :href="source.url"
        target="_blank"
        rel="noopener noreferrer"
        class="font-semibold text-foreground/80 hover:underline"
      >{{ source.name }}</a>
      <strong v-else class="text-foreground/80">{{ source.name }}</strong>
    </template>
  </div>
</template>
