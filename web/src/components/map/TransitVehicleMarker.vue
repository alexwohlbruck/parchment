<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import {
  TrainFrontIcon,
  BusIcon,
  ShipIcon,
  TramFrontIcon,
} from 'lucide-vue-next'

interface Props {
  vehicleId: string
  routeShortName?: string
  routeColor?: string     // hex without #
  routeTextColor?: string // hex without #
  routeType?: number | string
  bearing?: number
  timestamp?: string
  selected?: boolean
  dimmed?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  routeShortName: undefined,
  routeColor: undefined,
  routeTextColor: undefined,
  routeType: undefined,
  bearing: undefined,
  timestamp: undefined,
  selected: false,
  dimmed: false,
})

const emit = defineEmits<{
  select: [vehicleId: string]
}>()

const bgColor = computed(() =>
  props.routeColor ? `#${props.routeColor}` : 'hsl(var(--foreground))',
)

const textColor = computed(() =>
  props.routeTextColor ? `#${props.routeTextColor}` : 'hsl(var(--background))',
)

const vehicleIcon = computed(() => {
  const t = typeof props.routeType === 'string' ? parseInt(props.routeType, 10) : props.routeType
  if (t === 0) return TramFrontIcon
  if (t === 1) return TrainFrontIcon
  if (t === 2) return TrainFrontIcon
  if (t === 4) return ShipIcon
  return BusIcon
})

const routeTypeLabel = computed(() => {
  const t = typeof props.routeType === 'string' ? parseInt(props.routeType, 10) : props.routeType
  if (t === 0) return 'Tram'
  if (t === 1) return 'Subway'
  if (t === 2) return 'Rail'
  if (t === 3) return 'Bus'
  if (t === 4) return 'Ferry'
  return 'Transit'
})

const now = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  tickTimer = setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
})

const isStale = computed(() => {
  if (!props.timestamp) return true
  const age = now.value - new Date(props.timestamp).getTime()
  return age > 2 * 60 * 1000
})

const timeAgo = computed(() => {
  if (!props.timestamp) return null
  const seconds = Math.floor(
    (now.value - new Date(props.timestamp).getTime()) / 1000,
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
          :class="{ stale: isStale, selected, dimmed }"
          @click.stop="emit('select', vehicleId)"
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

          <!-- Main circle with vehicle icon -->
          <div
            class="vehicle-circle"
            :style="{ background: bgColor, color: textColor }"
          >
            <component :is="vehicleIcon" class="vehicle-icon" />
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
  will-change: transform;
}

.vehicle-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 12px;
  border: 2px solid white;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3), 0 0 0 0.5px rgba(0, 0, 0, 0.1);
  transition: transform 0.15s ease;
}

.transit-vehicle-marker:hover .vehicle-circle {
  transform: scale(1.15);
}

.vehicle-icon {
  width: 14px;
  height: 14px;
}

.direction-arrow {
  position: absolute;
  top: -6px;
  left: 50%;
  margin-left: -4px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-bottom: 6px solid currentColor;
  z-index: -1;
  transform-origin: center calc(100% + 9px);
}

.transit-vehicle-marker.selected .vehicle-circle {
  transform: scale(1.3);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35), 0 0 0 2px rgba(255, 255, 255, 0.9);
}

.transit-vehicle-marker.dimmed {
  opacity: 0.35;
}

.transit-vehicle-marker.stale {
  opacity: 0.4;
}

.transit-vehicle-marker.stale .vehicle-circle {
  border-color: hsl(var(--muted));
}
</style>
