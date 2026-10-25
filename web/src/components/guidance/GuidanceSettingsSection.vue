<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { CameraIcon, ScanEyeIcon } from 'lucide-vue-next'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGuidanceStore } from '@/stores/guidance.store'
import { CAMERA_MODES } from '@/lib/guidance/camera-framing'

const { preferences } = storeToRefs(useGuidanceStore())
</script>

<template>
  <SettingsSection id="navigation" :title="$t('guidance.settings.title')">
    <SettingsItem
      :title="$t('guidance.settings.cameraMode')"
      :description="$t('guidance.settings.cameraModeDescription')"
      :icon="CameraIcon"
    >
      <Select v-model="preferences.cameraMode">
        <SelectTrigger class="w-fit"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem v-for="mode in CAMERA_MODES" :key="mode" :value="mode">
              {{ $t(`guidance.camera.modes.${mode}`) }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </SettingsItem>
    <SettingsItem
      :title="$t('guidance.settings.bearingMode')"
      :description="$t('guidance.settings.bearingModeDescription')"
      :icon="ScanEyeIcon"
    >
      <Select v-model="preferences.bearingMode">
        <SelectTrigger class="w-fit"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="look-ahead">{{ $t('guidance.camera.bearing.look-ahead') }}</SelectItem>
            <SelectItem value="straight">{{ $t('guidance.camera.bearing.straight') }}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </SettingsItem>
  </SettingsSection>
</template>
