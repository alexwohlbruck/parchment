<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { RulerIcon, PencilRulerIcon, CircleDotIcon } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMapToolsStore } from '@/stores/map-tools.store'

const { t } = useI18n()
const mapToolsStore = useMapToolsStore()

const isMeasureActive = computed(() => mapToolsStore.activeTool === 'measure')
const isRadiusActive = computed(() => mapToolsStore.activeTool === 'radius')

function toggleMeasure() {
  mapToolsStore.setActiveTool(
    mapToolsStore.activeTool === 'measure' ? 'none' : 'measure',
  )
}

function toggleRadius() {
  mapToolsStore.setActiveTool(
    mapToolsStore.activeTool === 'radius' ? 'none' : 'radius',
  )
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="outline"
        size="icon-md"
        :class="{ 'border-primary': isMeasureActive || isRadiusActive }"
      >
        <PencilRulerIcon class="size-5" stroke-width="1.5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="min-w-[10rem]">
      <DropdownMenuItem
        @click="toggleMeasure()"
        :class="{ 'bg-accent': isMeasureActive }"
      >
        <RulerIcon class="size-4 mr-2" />
        {{ t('measure.distance') }}
      </DropdownMenuItem>
      <DropdownMenuItem
        @click="toggleRadius()"
        :class="{ 'bg-accent': isRadiusActive }"
      >
        <CircleDotIcon class="size-4 mr-2" />
        {{ t('measure.circle') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
