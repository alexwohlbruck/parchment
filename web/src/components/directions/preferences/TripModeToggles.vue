<script setup lang="ts">
import { useId } from 'vue'
import {
  BikeIcon,
  CarFrontIcon,
  CarTaxiFrontIcon,
  SquareParkingIcon,
  TrainFrontIcon,
  type LucideIcon,
} from 'lucide-vue-next'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { SettingsItem } from '@/components/settings'
import { TRIP_MODE_TOKENS, type TripModeToken } from '@/types/multimodal.types'
import { RIDESHARE_ENABLED } from '@/stores/directions.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'

const MODE_ICONS: Record<TripModeToken, LucideIcon> = {
  transit: TrainFrontIcon,
  biking: BikeIcon,
  bikeshare: SquareParkingIcon,
  rideshare: CarTaxiFrontIcon,
  driving: CarFrontIcon,
}

defineProps<{ layout?: 'compact' | 'settings' }>()

const modes = TRIP_MODE_TOKENS.filter(mode => mode !== 'rideshare' || RIDESHARE_ENABLED)
const preferences = useNavigationPreferencesStore()
const id = useId()
</script>

<template>
  <template v-if="layout === 'settings'">
    <SettingsItem
      v-for="mode in modes"
      :key="mode"
      :title="$t(`directions.tripModes.${mode}`)"
      :icon="MODE_ICONS[mode]"
    >
      <Switch
        :model-value="preferences.isModeEnabled(mode)"
        @update:model-value="preferences.setModeEnabled(mode, $event)"
      />
    </SettingsItem>
  </template>

  <div v-else class="flex flex-col gap-3">
    <div v-for="mode in modes" :key="mode" class="flex items-center gap-3">
      <component :is="MODE_ICONS[mode]" class="size-4 text-muted-foreground" />
      <Label :for="`${id}-${mode}`" class="flex-1 text-sm font-normal">
        {{ $t(`directions.tripModes.${mode}`) }}
      </Label>
      <Switch
        :id="`${id}-${mode}`"
        :model-value="preferences.isModeEnabled(mode)"
        @update:model-value="preferences.setModeEnabled(mode, $event)"
      />
    </div>
  </div>
</template>
