<script setup lang="ts">
import { computed } from 'vue'
import { CheckIcon } from 'lucide-vue-next'
import { useGuidanceStore } from '@/stores/guidance.store'
import { INDICATORS, inkOn, VEHICLE_COLORS, vehicleChoice, type PuckMode } from '@/lib/guidance/vehicle-indicator'
import VehicleThumbnail from './VehicleThumbnail.vue'

const props = defineProps<{ mode: PuckMode }>()

const guidance = useGuidanceStore()
const choice = computed(() => vehicleChoice(guidance.preferences.vehicle, props.mode))
const indicators = computed(() => INDICATORS[props.mode])
</script>

<template>
  <div class="space-y-2">
    <div v-if="indicators.length > 1" class="flex flex-wrap gap-1.5">
      <button
        v-for="indicator in indicators"
        :key="indicator"
        class="flex flex-col items-center gap-0.5 rounded-xl border px-2 pb-1 pt-1.5 text-xs transition-colors"
        :class="choice.indicator === indicator ? 'border-foreground/60 bg-muted font-medium' : 'border-transparent text-muted-foreground hover:bg-muted'"
        :aria-pressed="choice.indicator === indicator"
        @click="guidance.setVehicle(mode, { indicator })"
      >
        <VehicleThumbnail :indicator="indicator" :color="choice.color" />
        {{ $t(`guidance.vehicle.indicators.${indicator}`) }}
      </button>
    </div>
    <div class="flex flex-wrap gap-2" role="radiogroup" :aria-label="$t('guidance.vehicle.color')">
      <button
        v-for="color in VEHICLE_COLORS"
        :key="color"
        class="flex size-7 items-center justify-center rounded-full ring-1 ring-inset ring-black/15 transition-transform hover:scale-110"
        :class="choice.color === color && 'ring-2 ring-offset-2 ring-offset-background ring-foreground/70'"
        :style="{ background: color }"
        role="radio"
        :aria-checked="choice.color === color"
        :aria-label="color"
        @click="guidance.setVehicle(mode, { color })"
      >
        <CheckIcon v-if="choice.color === color" class="size-3.5" :style="{ color: inkOn(color) }" />
      </button>
    </div>
  </div>
</template>
