<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  RulerIcon,
  PencilRulerIcon,
  CircleDotIcon,
  RadarIcon,
} from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMapToolsStore, type MapToolId } from '@/stores/map-tools.store'

const { t } = useI18n()
const mapToolsStore = useMapToolsStore()

const isMeasureActive = computed(() => mapToolsStore.activeTool === 'measure')
const isRadiusActive = computed(() => mapToolsStore.activeTool === 'radius')
const isIsochroneActive = computed(
  () => mapToolsStore.activeTool === 'isochrone',
)
const isAnyToolActive = computed(() => mapToolsStore.activeTool !== 'none')

function toggleTool(tool: MapToolId) {
  mapToolsStore.setActiveTool(mapToolsStore.activeTool === tool ? 'none' : tool)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="outline"
        size="icon-md"
        :class="{ 'border-primary': isAnyToolActive }"
      >
        <PencilRulerIcon class="size-5" stroke-width="1.5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="min-w-[10rem]">
      <DropdownMenuItem
        @click="toggleTool('measure')"
        :class="{ 'bg-accent': isMeasureActive }"
      >
        <RulerIcon class="size-4 mr-2" />
        {{ t('measure.distance') }}
      </DropdownMenuItem>
      <DropdownMenuItem
        @click="toggleTool('radius')"
        :class="{ 'bg-accent': isRadiusActive }"
      >
        <CircleDotIcon class="size-4 mr-2" />
        {{ t('measure.circle') }}
      </DropdownMenuItem>
      <DropdownMenuItem
        @click="toggleTool('isochrone')"
        :class="{ 'bg-accent': isIsochroneActive }"
      >
        <RadarIcon class="size-4 mr-2" />
        {{ t('isochrone.title') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
