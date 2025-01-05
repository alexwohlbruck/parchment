<script setup lang="ts">
import { ref } from 'vue'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ThemeControls from './ThemeControls.vue'
import { SettingsSection, SettingsItem } from '@/components/settings'

const mapTheme = ref('auto')
</script>

<template>
  <div class="flex flex-col gap-4 w-fit">
    <SettingsSection :title="$t('settings.appearance.appTheme.title')">
      <ThemeControls class="mt-3" />
    </SettingsSection>

    <SettingsSection :title="$t('settings.appearance.mapTheme.title')">
      <SettingsItem :title="$t('settings.appearance.mapTheme.title')">
        <Select v-model="mapTheme">
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="auto">
                {{ $t('settings.appearance.mapTheme.values.matchTime') }}
              </SelectItem>
              <SelectItem value="match">{{
                $t('settings.appearance.mapTheme.values.match')
              }}</SelectItem>
              <SelectItem value="light">{{
                $t('settings.appearance.mapTheme.values.day')
              }}</SelectItem>
              <SelectItem value="dark">{{
                $t('settings.appearance.mapTheme.values.night')
              }}</SelectItem>
              <SelectItem value="dawn">{{
                $t('settings.appearance.mapTheme.values.dawn')
              }}</SelectItem>
              <SelectItem value="dusk">{{
                $t('settings.appearance.mapTheme.values.dusk')
              }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>
  </div>
</template>
