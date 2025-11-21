<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Locate } from 'lucide-vue-next'
import { useMapService } from '@/services/map.service'

const mapService = useMapService()
</script>

<template>
  <div class="flex flex-col">
    <Button
      variant="outline"
      size="icon-sm"
      class="rounded-md"
      @click="mapService.locate()"
    >
      <Locate class="size-4" strokeWidth="2.75" />
    </Button>
  </div>
</template>
