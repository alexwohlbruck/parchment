<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useMapStore } from '@/stores/map.store'
import { ControlVisibility } from '@/types/map.types'
import { CommandName } from '@/stores/command.store'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  BugIcon,
  CloudSun,
  CompassIcon,
  LocateIcon,
  PersonStandingIcon,
  RulerIcon,
  ZoomInIcon,
} from 'lucide-vue-next'

const { controlSettings } = storeToRefs(useMapStore())

type ToggleableControl = 'zoom' | 'locate' | 'weather' | 'debug'

function isControlShown(control: ToggleableControl) {
  return controlSettings.value[control] === ControlVisibility.ALWAYS
}

function setControlShown(control: ToggleableControl, shown: boolean) {
  controlSettings.value[control] = shown
    ? ControlVisibility.ALWAYS
    : ControlVisibility.NEVER
}
</script>

<template>
  <SettingsSection
    id="controls"
    :title="$t('settings.mapSettings.controls.title')"
  >
    <SettingsItem
      :title="$t('settings.mapSettings.controls.zoom')"
      :icon="ZoomInIcon"
    >
      <Switch
        :model-value="isControlShown('zoom')"
        @update:model-value="setControlShown('zoom', $event)"
      />
    </SettingsItem>

    <SettingsItem
      :title="$t('settings.mapSettings.controls.compass')"
      :icon="CompassIcon"
    >
      <Select v-model="controlSettings.compass">
        <SelectTrigger class="w-fit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem :value="ControlVisibility.ALWAYS">
              {{ $t('settings.mapSettings.controls.visibility.always') }}
            </SelectItem>
            <SelectItem :value="ControlVisibility.WHILE_ROTATING">
              {{ $t('settings.mapSettings.controls.visibility.whileRotating') }}
            </SelectItem>
            <SelectItem :value="ControlVisibility.NEVER">
              {{ $t('settings.mapSettings.controls.visibility.never') }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </SettingsItem>

    <SettingsItem
      :title="$t('settings.mapSettings.controls.scale')"
      :icon="RulerIcon"
    >
      <Select v-model="controlSettings.scale">
        <SelectTrigger class="w-fit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem :value="ControlVisibility.ALWAYS">
              {{ $t('settings.mapSettings.controls.visibility.always') }}
            </SelectItem>
            <SelectItem :value="ControlVisibility.WHILE_ZOOMING">
              {{ $t('settings.mapSettings.controls.visibility.whileZooming') }}
            </SelectItem>
            <SelectItem :value="ControlVisibility.NEVER">
              {{ $t('settings.mapSettings.controls.visibility.never') }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </SettingsItem>

    <SettingsItem
      :title="$t('settings.mapSettings.controls.streetView')"
      :icon="PersonStandingIcon"
    >
      <Select v-model="controlSettings.streetView">
        <SelectTrigger class="w-fit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem :value="ControlVisibility.ALWAYS">
              {{ $t('settings.mapSettings.controls.visibility.always') }}
            </SelectItem>
            <SelectItem :value="ControlVisibility.WHILE_ACTIVE">
              {{ $t('settings.mapSettings.controls.visibility.whileActive') }}
            </SelectItem>
            <SelectItem :value="ControlVisibility.NEVER">
              {{ $t('settings.mapSettings.controls.visibility.never') }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </SettingsItem>

    <SettingsItem
      :title="$t('settings.mapSettings.controls.locate')"
      :icon="LocateIcon"
    >
      <Switch
        :model-value="isControlShown('locate')"
        @update:model-value="setControlShown('locate', $event)"
      />
    </SettingsItem>

    <SettingsItem
      :title="$t('settings.mapSettings.controls.weather')"
      :icon="CloudSun"
    >
      <Switch
        :model-value="isControlShown('weather')"
        @update:model-value="setControlShown('weather', $event)"
      />
    </SettingsItem>

    <SettingsItem
      :title="$t('settings.mapSettings.controls.debug')"
      :description="$t('settings.mapSettings.controls.debugDescription')"
      :icon="BugIcon"
      :command-id="CommandName.TOGGLE_MAP_DEBUG"
    >
      <Switch
        :model-value="isControlShown('debug')"
        @update:model-value="setControlShown('debug', $event)"
      />
    </SettingsItem>
  </SettingsSection>
</template>
