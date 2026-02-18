<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { useCommandStore } from '@/stores/command.store'
import { CommandName } from '@/stores/command.store'
import { UnitSystem } from '@/types/map.types'
import type { Locale } from '@/lib/i18n'
import { updatePreferences } from '@/services/preferences.service'
import { SettingsSection, SettingsItem } from '@/components/settings'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Gauge, LanguagesIcon } from 'lucide-vue-next'

const appStore = useAppStore()
const authStore = useAuthStore()
const commandStore = useCommandStore()
const { unitSystem } = storeToRefs(appStore)
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
