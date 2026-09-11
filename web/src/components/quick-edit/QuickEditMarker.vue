<script setup lang="ts">
import PoiMarker from '@/components/map/markers/PoiMarker.vue'

defineProps<{
  iconName?: string
  iconPack?: 'lucide' | 'maki'
  category?: string
  label?: string
}>()
</script>

<template>
  <div class="relative flex cursor-grab items-center justify-center">
    <div class="pulse-ring absolute size-[40px] rounded-full" />
    <PoiMarker
      :icon-name="iconName ?? 'MapPin'"
      :icon-pack="iconPack ?? 'lucide'"
      :category="category ?? 'default'"
      :label="label"
    />
  </div>
</template>

<style scoped>
div {
  pointer-events: all;
}

/* Marks the pin as the thing being placed, and as draggable. */
.pulse-ring {
  background: hsl(var(--primary) / 0.25);
  animation: pulse-expand 2s ease-out infinite;
}

@keyframes pulse-expand {
  0% {
    transform: scale(0.8);
    opacity: 1;
  }
  100% {
    transform: scale(1.8);
    opacity: 0;
  }
}
</style>
