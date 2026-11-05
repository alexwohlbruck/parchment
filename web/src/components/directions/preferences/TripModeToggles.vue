<script setup lang="ts">
import { useId } from 'vue'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { SettingsItem } from '@/components/settings'
import { TRIP_MODE_TOKENS } from '@/types/multimodal.types'
import { RIDESHARE_ENABLED } from '@/stores/directions.store'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { getModeIcon } from '@/lib/directions/travel-mode-icons'
import type { PreferenceLayout } from '@/composables/directions/useRoutingPreferenceControls'

defineProps<{ layout?: PreferenceLayout }>()

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
      :icon="getModeIcon(mode)"
    >
      <Switch
        :model-value="preferences.isModeEnabled(mode)"
        @update:model-value="preferences.setModeEnabled(mode, $event)"
      />
    </SettingsItem>
  </template>

  <div v-else class="flex flex-col gap-3">
    <div v-for="mode in modes" :key="mode" class="flex items-center gap-3">
      <component :is="getModeIcon(mode)" class="size-4 text-muted-foreground" />
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
