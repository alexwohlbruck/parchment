<script setup lang="ts">
import { computed } from 'vue'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'

interface Props {
  vehicleId: string
  routeShortName?: string
  routeColor?: string     // hex without #
  routeTextColor?: string // hex without #
  routeType?: string
  bearing?: number
  timestamp?: string
}

const props = withDefaults(defineProps<Props>(), {
  routeShortName: undefined,
  routeColor: undefined,
  routeTextColor: undefined,
  routeType: undefined,
  bearing: undefined,
  timestamp: undefined,
})

const displayName = computed(() => {
  if (!props.routeShortName) return '?'
  return props.routeShortName.length > 4
    ? props.routeShortName.slice(0, 4)
    : props.routeShortName
})

const bgColor = computed(() =>
  props.routeColor ? `#${props.routeColor}` : 'hsl(var(--foreground))',
)

const textColor = computed(() =>
  props.routeTextColor ? `#${props.routeTextColor}` : 'hsl(var(--background))',
)

const routeTypeLabel = computed(() => {
  const labels: Record<string, string> = {
    bus: 'Bus',
    tram: 'Tram',
    subway: 'Subway',
    rail: 'Rail',
    ferry: 'Ferry',
    cable_tram: 'Cable tram',
    aerial_lift: 'Aerial lift',
    funicular: 'Funicular',
    trolleybus: 'Trolleybus',
    monorail: 'Monorail',
  }
  return labels[props.routeType ?? ''] ?? 'Transit'
})

const isStale = computed(() => {
  if (!props.timestamp) return true
  const age = Date.now() - new Date(props.timestamp).getTime()
  return age > 2 * 60 * 1000
})

const timeAgo = computed(() => {
  if (!props.timestamp) return null
  const seconds = Math.floor(
    (Date.now() - new Date(props.timestamp).getTime()) / 1000,
  )
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ago`
})
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          class="transit-vehicle-marker"
          :class="{ stale: isStale }"
        >
          <!-- Direction arrow -->
          <div
            v-if="bearing != null && !isStale"
            class="direction-arrow"
            :style="{
              transform: `rotate(${bearing}deg)`,
              borderBottomColor: bgColor,
            }"
          />

          <!-- Main circle with route short name -->
          <div
            class="vehicle-circle"
            :style="{ background: bgColor, color: textColor }"
          >
            <span class="route-name">{{ displayName }}</span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" :sideOffset="10">
        <div class="flex flex-col gap-0.5">
          <p class="font-semibold text-sm">
            {{ routeShortName || 'Unknown' }}
            <span class="font-normal text-muted-foreground"> · {{ routeTypeLabel }}</span>
          </p>
          <p v-if="timeAgo" class="text-xs text-muted-foreground">
            Updated {{ timeAgo }}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<style scoped>
.transit-vehicle-marker {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

.vehicle-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 3px;
  border-radius: 10px;
  border: 2px solid white;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3), 0 0 0 0.5px rgba(0, 0, 0, 0.1);
  transition: transform 0.15s ease;
}

.transit-vehicle-marker:hover .vehicle-circle {
  transform: scale(1.2);
}

.route-name {
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  letter-spacing: -0.02em;
}

.direction-arrow {
  position: absolute;
  top: -7px;
  left: 50%;
  margin-left: -4px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-bottom: 6px solid currentColor;
  z-index: -1;
  transform-origin: center calc(100% + 10px);
}

/* Stale state */
.transit-vehicle-marker.stale {
  opacity: 0.4;
}

.transit-vehicle-marker.stale .vehicle-circle {
  border-color: hsl(var(--muted));
}
</style>
