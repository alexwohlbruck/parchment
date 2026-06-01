<script setup lang="ts">
import { CarFrontIcon, BikeIcon, TruckIcon, AccessibilityIcon, type LucideIcon } from 'lucide-vue-next'

interface Props {
  vehicleType: string
  vehicleName?: string | null
  staleness?: 'fresh' | 'aging' | 'stale' | 'very-stale' | 'unknown'
}

const props = withDefaults(defineProps<Props>(), {
  staleness: 'fresh',
})

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

const IconComponent = vehicleTypeIcons[props.vehicleType] || CarFrontIcon
</script>

<template>
  <div
    class="vehicle-location-marker"
    :class="[`staleness-${staleness}`]"
    :title="vehicleName || vehicleType"
  >
    <div class="marker-body">
      <component :is="IconComponent" class="marker-icon" />
    </div>
    <div class="marker-pin" />
  </div>
</template>

<style scoped>
.vehicle-location-marker {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: grab;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3));
}

.vehicle-location-marker:active {
  cursor: grabbing;
}

.marker-body {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: hsl(var(--background));
  border: 2.5px solid hsl(var(--foreground));
  transition: opacity 0.2s ease, border-color 0.2s ease;
}

.marker-icon {
  width: 16px;
  height: 16px;
  color: hsl(var(--foreground));
}

.marker-pin {
  width: 2px;
  height: 6px;
  background: hsl(var(--foreground));
  margin-top: -1px;
}

/* Staleness states */
.staleness-stale .marker-body {
  opacity: 0.7;
  border-color: hsl(var(--muted-foreground));
}
.staleness-stale .marker-icon {
  color: hsl(var(--muted-foreground));
}
.staleness-stale .marker-pin {
  background: hsl(var(--muted-foreground));
}

.staleness-very-stale .marker-body {
  opacity: 0.5;
  border-color: hsl(var(--muted-foreground));
  border-style: dashed;
}
.staleness-very-stale .marker-icon {
  color: hsl(var(--muted-foreground));
}
.staleness-very-stale .marker-pin {
  background: hsl(var(--muted-foreground));
}
</style>
