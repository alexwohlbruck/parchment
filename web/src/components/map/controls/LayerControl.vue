<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Layers3Icon } from 'lucide-vue-next'
import LayersSelector from '@/components/navigation/LayersSelector.vue'
import ResponsiveHoverCard from '@/components/responsive/ResponsiveHoverCard.vue'
</script>

<template>
  <ResponsiveHoverCard
    :open-delay="0"
    :close-delay="100"
    side="left"
    align="end"
    :side-offset="12"
    desktop-content-class="w-[360px] max-w-[calc(100vw-3.75rem)] md:max-w-[400px] p-4 shadow-xl"
    :custom-snap-points="['400px', 0.7, 1]"
  >
    <template #trigger>
      <Button variant="outline" size="icon-sm" class="rounded-md size-11">
        <Layers3Icon class="size-5" />
      </Button>
    </template>

    <template #content>
      <LayersSelector />
    </template>
  </ResponsiveHoverCard>
</template>
