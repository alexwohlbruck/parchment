<script setup lang="ts">
import { type Layer } from '@/types/map.types'

const props = defineProps<{
  layer: Layer
}>()
</script>

<template>
  <div v-if="layer">
    <h2>{{ layer.name }}</h2>
  </div>
</template>
