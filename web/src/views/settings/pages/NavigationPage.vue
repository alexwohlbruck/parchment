<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDownWideNarrowIcon } from 'lucide-vue-next'
import { SettingsSection, SettingsItem } from '@/components/settings'
import TripModeToggles from '@/components/directions/preferences/TripModeToggles.vue'
import TripSortSelect from '@/components/directions/preferences/TripSortSelect.vue'
import RoutingGeneralFields from '@/components/directions/preferences/RoutingGeneralFields.vue'
import RoutingModeFields from '@/components/directions/preferences/RoutingModeFields.vue'
import VehicleSettingsSection from '@/components/vehicles/VehicleSettingsSection.vue'
import GuidanceSettingsSection from '@/components/guidance/GuidanceSettingsSection.vue'
import { useNavigationPreferencesStore } from '@/stores/preferences/navigation-preferences.store'
import { ROUTING_MODES, type TripSort } from '@/lib/preferences/navigation-preferences'

const preferences = useNavigationPreferencesStore()

const defaultSort = computed({
  get: (): TripSort => preferences.sortPreference ?? 'balanced',
  set: (sort: TripSort) => {
    preferences.sortPreference = sort === 'balanced' ? null : sort
  },
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection
      id="modes"
      :title="$t('settings.navigation.modes.title')"
      :description="$t('settings.navigation.modes.description')"
    >
      <TripModeToggles layout="settings" />
    </SettingsSection>

    <SettingsSection id="trip-preference" :title="$t('settings.navigation.tripPreference.title')">
      <SettingsItem
        :title="$t('settings.navigation.tripPreference.rankBy')"
        :description="$t('settings.navigation.tripPreference.rankByDescription')"
        :icon="ArrowDownWideNarrowIcon"
      >
        <TripSortSelect v-model="defaultSort" trigger-class="w-fit" />
      </SettingsItem>
    </SettingsSection>

    <SettingsSection id="routing" :title="$t('settings.navigation.routing.title')">
      <RoutingGeneralFields layout="settings" />
    </SettingsSection>

    <SettingsSection
      v-for="mode in ROUTING_MODES"
      :id="`routing-${mode}`"
      :key="mode"
      :title="$t(`settings.navigation.routing.modes.${mode}`)"
    >
      <RoutingModeFields :mode="mode" layout="settings" />
    </SettingsSection>

    <VehicleSettingsSection />

    <GuidanceSettingsSection />
  </div>
</template>
