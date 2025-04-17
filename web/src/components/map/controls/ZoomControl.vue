<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Plus, Minus } from 'lucide-vue-next'
import { useMapService } from '@/services/map.service'

const mapService = useMapService()
</script>

<template>
  <div class="flex flex-col shadow-md rounded-md">
    <Button
      variant="outline"
      size="icon-sm"
      class="rounded-none rounded-t-md"
      @click="mapService.zoomIn()"
    >
      <Plus class="size-4" strokeWidth="2.75" />
    </Button>
    <Button
      variant="outline"
      size="icon-sm"
      class="rounded-none rounded-b-md border-t-0"
      @click="mapService.zoomOut()"
    >
      <Minus class="size-4" strokeWidth="2.75" />
    </Button>
  </div>
</template>
