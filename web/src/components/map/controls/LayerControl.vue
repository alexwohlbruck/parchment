<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Layers3Icon } from 'lucide-vue-next'
import LayersSelector from '@/components/navigation/LayersSelector.vue'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
</script>

<template>
  <HoverCard :openDelay="0" :closeDelay="0">
    <HoverCardTrigger as-child>
      <Button variant="outline" size="icon" class="size-10 shadow-md">
        <Layers3Icon class="size-5" />
      </Button>
    </HoverCardTrigger>

    <HoverCardContent
      side="left"
      align="end"
      :side-offset="8"
      class="w-fit fit-content max-w-[calc(100vw-3.75rem)] md:max-w-[50vw]"
    >
      <LayersSelector />
    </HoverCardContent>
  </HoverCard>
</template>
