<script setup lang="ts">
import { computed } from 'vue'
import { CarFrontIcon, ShipIcon, SquareParkingIcon, WaypointsIcon } from 'lucide-vue-next'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  useRoutingPreferenceControls,
  type PreferenceLayout,
} from '@/composables/directions/useRoutingPreferenceControls'
import PreferenceField from './PreferenceField.vue'
import PreferenceRow from './PreferenceRow.vue'

const props = defineProps<{ layout: PreferenceLayout }>()

const { preferences, updatePreference, routingEngines, selectedEngine } = useRoutingPreferenceControls(
  () => 'walking',
  props.layout,
)

const useKnownVehicleLocations = computed({
  get: () => preferences.value.useKnownVehicleLocations ?? true,
  set: (value: boolean) => updatePreference('useKnownVehicleLocations', value),
})

const useKnownParkingLocations = computed({
  get: () => preferences.value.useKnownParkingLocations ?? true,
  set: (value: boolean) => updatePreference('useKnownParkingLocations', value),
})

const compact = computed(() => props.layout === 'compact')
const field = (key: string) => `directions.preferences.fields.${key}`
</script>

<template>
  <PreferenceField v-if="routingEngines.length > 1" :label="$t(field('routingEngine'))" :icon="WaypointsIcon">
    <Select
      :model-value="selectedEngine"
      @update:model-value="value => (selectedEngine = value ? String(value) : null)"
    >
      <SelectTrigger :class="compact ? 'h-8 w-[140px] text-xs' : 'w-fit'">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="engine in routingEngines"
          :key="engine.integrationId"
          :value="engine.integrationId"
          :class="compact ? 'text-xs' : undefined"
        >
          {{ engine.name }}
        </SelectItem>
      </SelectContent>
    </Select>
  </PreferenceField>

  <PreferenceField
    :label="$t(field('knownVehicles'))"
    :description="compact ? undefined : $t(field('knownVehiclesDescription'))"
    :icon="CarFrontIcon"
  >
    <Switch v-model="useKnownVehicleLocations" />
  </PreferenceField>

  <PreferenceField
    :label="$t(field('knownParking'))"
    :description="compact ? undefined : $t(field('knownParkingDescription'))"
    :icon="SquareParkingIcon"
  >
    <Switch v-model="useKnownParkingLocations" />
  </PreferenceField>

  <PreferenceRow pref="ferries" :label="$t(field('ferries'))" :icon="ShipIcon" />
</template>
