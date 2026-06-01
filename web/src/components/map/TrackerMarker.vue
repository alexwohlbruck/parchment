<script setup lang="ts">
import { computed } from 'vue'
import {
  CarFrontIcon,
  BikeIcon,
  TruckIcon,
  AccessibilityIcon,
  MapPinIcon,
  type LucideIcon,
} from 'lucide-vue-next'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import { mapEventBus } from '@/lib/eventBus'

interface Props {
  trackerId: string
  trackerName: string
  trackerType: string
  updatedAt?: Date
  staleness?: 'fresh' | 'aging' | 'stale' | 'very-stale' | 'unknown'
}

const props = withDefaults(defineProps<Props>(), {
  staleness: 'fresh',
})

function handleClick() {
  mapEventBus.emit('click:tracker-marker', { trackerId: props.trackerId })
}

const vehicleTypeIcons: Record<string, LucideIcon> = {
  car: CarFrontIcon,
  truck: TruckIcon,
  moped: BikeIcon,
  bike: BikeIcon,
  'e-bike': BikeIcon,
  scooter: BikeIcon,
  'e-scooter': BikeIcon,
  wheelchair: AccessibilityIcon,
}

const IconComponent = computed(() => vehicleTypeIcons[props.trackerType] || MapPinIcon)

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const timeAgo = computed(() => {
  if (!props.updatedAt) return null
  return formatTimeAgo(props.updatedAt)
})

const isStale = computed(() => {
  return props.staleness === 'stale' || props.staleness === 'very-stale'
})
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          class="tracker-marker"
          :class="{ stale: isStale }"
          @click="handleClick"
        >
          <!-- Pulsing ring behind the icon -->
          <div class="marker-pulse" />

          <!-- Main icon circle -->
          <div class="marker-icon-wrap">
            <div class="icon-circle">
              <component :is="IconComponent" class="icon" />
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" :sideOffset="12">
        <div class="flex flex-col gap-0.5">
          <p class="font-semibold text-sm">{{ trackerName }}</p>
          <p v-if="timeAgo" class="text-xs text-muted-foreground">
            {{ isStale ? 'Last seen' : 'Updated' }} {{ timeAgo }}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<style scoped>
.tracker-marker {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.marker-icon-wrap {
  position: relative;
  z-index: 2;
  transition: transform 0.15s ease;
}

.tracker-marker:hover .marker-icon-wrap {
  transform: scale(1.15);
}

.icon-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: hsl(var(--foreground));
  border: 2.5px solid white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.icon {
  width: 13px;
  height: 13px;
  color: hsl(var(--background));
}

.marker-pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: hsl(var(--foreground) / 0.2);
  animation: pulse 2.5s ease-out infinite;
  z-index: 1;
}

/* Stale states */
.tracker-marker.stale .marker-pulse {
  animation: none;
  opacity: 0;
}

.tracker-marker.stale .icon-circle {
  background: hsl(var(--muted-foreground));
  border-color: hsl(var(--muted));
  opacity: 0.8;
}

@keyframes pulse {
  0% {
    transform: translate(-50%, -50%) scale(0.9);
    opacity: 0.6;
  }
  70% {
    transform: translate(-50%, -50%) scale(1.8);
    opacity: 0;
  }
  100% {
    transform: translate(-50%, -50%) scale(1.8);
    opacity: 0;
  }
}
</style>
