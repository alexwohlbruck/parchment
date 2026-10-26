<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { BikeIcon, CameraIcon, GaugeIcon, NavigationIcon, ScanEyeIcon } from 'lucide-vue-next'
import { Switch } from '@/components/ui/switch'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGuidanceStore } from '@/stores/guidance.store'
import { CAMERA_MODES } from '@/lib/guidance/camera-framing'
import { PUCK_MODES } from '@/lib/guidance/vehicle-indicator'
import VehiclePicker from './VehiclePicker.vue'
import SpeechSettings from '@/components/speech/SpeechSettings.vue'
import { SPEED_DISPLAYS } from '@/lib/guidance/speed-display'

const { preferences } = storeToRefs(useGuidanceStore())
const premium = computed(() => useAuthService().hasPermission(PermissionId.PREMIUM_NAVIGATION))
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
    <SettingsItem
      :title="$t('guidance.settings.speedDisplay')"
      :description="$t('guidance.settings.speedDisplayDescription')"
      :icon="GaugeIcon"
    >
      <Select v-model="preferences.speedDisplay">
        <SelectTrigger class="w-fit"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem v-for="display in SPEED_DISPLAYS" :key="display" :value="display">
              {{ $t(`guidance.speed.displays.${display}`) }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </SettingsItem>
    <SpeechSettings />
    <SettingsItem :title="$t('guidance.settings.adaptiveSpeech')" :description="$t('guidance.settings.adaptiveSpeechDescription')">
      <Switch v-model="preferences.adaptiveSpeech" />
    </SettingsItem>
    <SettingsItem
      v-if="premium"
      :title="$t('guidance.settings.autoSwitchDocks')"
      :description="$t('guidance.settings.autoSwitchDocksDescription')"
      :icon="BikeIcon"
    >
      <Switch v-model="preferences.autoSwitchDocks" />
    </SettingsItem>
    <SettingsItem
      :title="$t('guidance.vehicle.title')"
      :description="$t('guidance.vehicle.description')"
      :icon="NavigationIcon"
    />
    <div class="-mt-1 space-y-4 pl-8">
      <div v-for="mode in PUCK_MODES" :key="mode" class="space-y-1.5">
        <div class="text-sm text-muted-foreground">{{ $t(`guidance.vehicle.modes.${mode}`) }}</div>
        <VehiclePicker :mode="mode" />
      </div>
    </div>
  </SettingsSection>
</template>
