<script setup lang="ts">
import { computed } from 'vue'
import { SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useGuidanceStore } from '@/stores/guidance.store'
import { vehicleChoice, type PuckMode } from '@/lib/guidance/vehicle-indicator'
import { getModeIcon } from '@/lib/directions/travel-mode-icons'
import VehiclePicker from './VehiclePicker.vue'
import VehicleThumbnail from './VehicleThumbnail.vue'

const props = defineProps<{ mode: PuckMode }>()

const guidance = useGuidanceStore()
const choice = computed(() => vehicleChoice(guidance.preferences.vehicle, props.mode))
</script>

<template>
  <SettingsItem :title="$t(`guidance.vehicle.modes.${mode}`)" :icon="getModeIcon(mode)">
    <Popover>
      <PopoverTrigger as-child>
        <Button variant="outline" class="h-10 w-16 px-2" :aria-label="$t('guidance.vehicle.title')">
          <VehicleThumbnail :indicator="choice.indicator" :color="choice.color" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" class="w-auto">
        <VehiclePicker :mode="mode" />
      </PopoverContent>
    </Popover>
  </SettingsItem>
</template>
