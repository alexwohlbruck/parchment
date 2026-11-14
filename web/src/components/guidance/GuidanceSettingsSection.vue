<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { usePremiumNavigation } from '@/composables/usePremiumNavigation'
import { computed } from 'vue'
import { BikeIcon, CameraIcon, FastForwardIcon, GaugeIcon, ScanEyeIcon } from 'lucide-vue-next'
import { Switch } from '@/components/ui/switch'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGuidanceStore } from '@/stores/guidance.store'
import { CAMERA_MODES } from '@/lib/guidance/camera-framing'
import { PUCK_MODES } from '@/lib/guidance/vehicle-indicator'
import { SPEED_DISPLAYS } from '@/lib/guidance/speed-display'
import SpeechSettings from '@/components/speech/SpeechSettings.vue'
import MarkerSetting from './MarkerSetting.vue'

const { preferences } = storeToRefs(useGuidanceStore())
const premium = usePremiumNavigation()
</script>

<template>
  <SettingsSection id="guidance" :title="$t('guidance.settings.title')">
    <SettingsItem
      :title="$t('guidance.settings.cameraMode')"
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
    <SettingsItem
      v-if="premium"
      :title="$t('guidance.settings.autoSwitchDocks')"
      :description="$t('guidance.settings.autoSwitchDocksDescription')"
      :icon="BikeIcon"
    >
      <Switch v-model="preferences.autoSwitchDocks" />
    </SettingsItem>
  </SettingsSection>

  <SettingsSection id="voice" :title="$t('guidance.settings.voiceTitle')">
    <SpeechSettings />
    <SettingsItem
      :title="$t('guidance.settings.adaptiveSpeech')"
      :description="$t('guidance.settings.adaptiveSpeechDescription')"
      :icon="FastForwardIcon"
    >
      <Switch v-model="preferences.adaptiveSpeech" />
    </SettingsItem>
  </SettingsSection>

  <SettingsSection
    id="location-marker"
    :title="$t('guidance.vehicle.title')"
    :description="$t('guidance.vehicle.description')"
  >
    <MarkerSetting v-for="mode in PUCK_MODES" :key="mode" :mode="mode" />
  </SettingsSection>
</template>
