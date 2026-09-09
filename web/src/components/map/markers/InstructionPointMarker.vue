<script setup lang="ts">
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'

interface Props {
  text: string
  segmentColor: string
  isHighlighted?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isHighlighted: false,
})
</script>

<template>
  <TooltipProvider :delayDuration="100">
    <Tooltip :open="isHighlighted ? true : undefined">
      <TooltipTrigger asChild>
        <div 
          class="instruction-point-marker"
          :class="{ highlighted: isHighlighted }"
        >
          <div 
            class="point-circle"
            :style="{ borderColor: segmentColor }"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" :sideOffset="8">
        <p class="text-xs max-w-[250px]">{{ text }}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<style scoped>
.instruction-point-marker {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.point-circle {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: white;
  border-width: 1.5px;
  border-style: solid;
  transition: all 0.15s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.instruction-point-marker.highlighted .point-circle {
  width: 12px;
  height: 12px;
  border-width: 2px;
}

.instruction-point-marker:hover .point-circle {
  width: 12px;
  height: 12px;
  border-width: 2px;
}
</style>
