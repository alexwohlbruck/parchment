<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { useCommandStore } from '@/stores/command.store'
import { CommandName } from '@/stores/command.store'
import { UnitSystem, LocateFlySpeed, StartupLocation, FloorNumbering } from '@/types/map.types'
import type { Locale } from '@/lib/i18n'
import { updatePreferences } from '@/services/preferences.service'
import { useMapStore } from '@/stores/map.store'
import { SettingsSection, SettingsItem } from '@/components/settings'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Gauge, GaugeIcon, LanguagesIcon, Navigation2Icon, LayersIcon } from 'lucide-vue-next'

const appStore = useAppStore()
const authStore = useAuthStore()
const commandStore = useCommandStore()
const mapStore = useMapStore()
const { unitSystem, floorNumbering } = storeToRefs(appStore)
const { settings } = storeToRefs(mapStore)
const { locale } = useI18n()

const languageCommand = commandStore.useCommand(CommandName.UPDATE_LANGUAGE)

// Persist language and unit preferences to backend when logged in
watch(
  [locale, unitSystem],
  ([newLocale, newUnitSystem]) => {
    if (!authStore.me) return
    updatePreferences({
      language: newLocale as Locale,
      unitSystem: newUnitSystem as UnitSystem,
    }).catch(() => {
      // Ignore errors (e.g. network); local state is already updated
    })
  },
  { deep: true },
)
</script>

<template>
  <div class="flex flex-col gap-4 w-fit items-start">
    <!-- Language preference -->
    <SettingsSection :title="$t('settings.behavior.language.title')">
      <SettingsItem
        v-if="languageCommand"
        :title="languageCommand.name"
        :description="languageCommand.description"
        :icon="LanguagesIcon"
      >
        <Select v-model="locale">
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="language in commandStore.getCommandArgumentOptions(
                CommandName.UPDATE_LANGUAGE,
                'language',
              )"
              :value="language.value.toString()"
            >
              {{ language.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>

    <!-- Location behavior -->
    <SettingsSection :title="$t('settings.mapSettings.location.title')">
      <SettingsItem
        :title="$t('settings.mapSettings.location.startupLocation')"
        :description="$t('settings.mapSettings.location.startupLocationDescription')"
        :icon="Navigation2Icon"
      >
        <Select
          :model-value="settings.startupLocation ?? StartupLocation.LAST_VISITED"
          @update:model-value="settings.startupLocation = $event as StartupLocation"
        >
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="StartupLocation.LOCATE_ME">
                {{ $t('settings.mapSettings.location.startup.locateMe') }}
              </SelectItem>
              <SelectItem :value="StartupLocation.LAST_VISITED">
                {{ $t('settings.mapSettings.location.startup.lastVisited') }}
              </SelectItem>
              <SelectItem :value="StartupLocation.URL_PARAMS">
                {{ $t('settings.mapSettings.location.startup.urlParams') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.location.locateFlySpeed')"
        :icon="GaugeIcon"
      >
        <Select
          :model-value="settings.locateFlySpeed ?? LocateFlySpeed.NORMAL"
          @update:model-value="settings.locateFlySpeed = $event as LocateFlySpeed"
        >
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="LocateFlySpeed.INSTANT">
                {{ $t('settings.mapSettings.location.speed.instant') }}
              </SelectItem>
              <SelectItem :value="LocateFlySpeed.FAST">
                {{ $t('settings.mapSettings.location.speed.fast') }}
              </SelectItem>
              <SelectItem :value="LocateFlySpeed.NORMAL">
                {{ $t('settings.mapSettings.location.speed.normal') }}
              </SelectItem>
              <SelectItem :value="LocateFlySpeed.SLOW">
                {{ $t('settings.mapSettings.location.speed.slow') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>

    <!-- Floor numbering preference -->
    <SettingsSection :title="$t('settings.behavior.floorNumbering.title')">
      <SettingsItem
        :title="$t('settings.behavior.floorNumbering.system')"
        :description="$t('settings.behavior.floorNumbering.description')"
        :icon="LayersIcon"
      >
        <Select v-model="floorNumbering">
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="FloorNumbering.ZERO_BASED">
                {{ $t('settings.behavior.floorNumbering.zeroBased') }}
              </SelectItem>
              <SelectItem :value="FloorNumbering.ONE_BASED">
                {{ $t('settings.behavior.floorNumbering.oneBased') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>

    <!-- Units preference -->
    <SettingsSection :title="$t('settings.behavior.units.title')">
      <SettingsItem
        :title="$t('settings.behavior.units.system')"
        :description="$t('settings.behavior.units.description')"
        :icon="Gauge"
      >
        <Select v-model="unitSystem">
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="UnitSystem.METRIC">
                {{ $t('settings.behavior.units.metric') }}
              </SelectItem>
              <SelectItem :value="UnitSystem.IMPERIAL">
                {{ $t('settings.behavior.units.imperial') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>
  </div>
</template>
