<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { useDeviceOnlyStore } from '@/stores/preferences/device-only.store'
import { useCommandStore } from '@/stores/command.store'
import { CommandName } from '@/stores/command.store'
import {
  UnitSystem,
  LocateFlySpeed,
  StartupLocation,
  FloorNumbering,
  GridSnapMode,
  MapEngine,
  MapProjection,
} from '@/types/map.types'
import type { Locale } from '@/lib/i18n'
import { updatePreferences } from '@/services/preferences.service'
import { useMapStore } from '@/stores/map.store'
import { usePowerStore } from '@/stores/power.store'
import { POWER_SAVERS, strongerSaver } from '@/lib/power/power-saver'
import { useMapService } from '@/services/map/map.service'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { useResponsive } from '@/lib/utils'
import { useFeedback } from '@/composables/integrations/useFeedback'
import { useShakeGesture } from '@/composables/useShakeGesture'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Gauge,
  GaugeIcon,
  Smartphone,
  LanguagesIcon,
  Navigation2Icon,
  LayersIcon,
  CompassIcon,
  Grid2x2,
  PanelBottom,
  BatteryLowIcon,
  BatteryWarningIcon,
  LeafIcon,
  PlugZapIcon,
} from 'lucide-vue-next'

const appStore = useAppStore()
const authStore = useAuthStore()
const deviceOnly = useDeviceOnlyStore()
const commandStore = useCommandStore()
const mapStore = useMapStore()
const power = usePowerStore()
const mapService = useMapService()
const { unitSystem, floorNumbering, shakeForFeedback, homeSheetStart } =
  storeToRefs(appStore)
const { settings } = storeToRefs(mapStore)
const { locale } = useI18n()

const languageCommand = commandStore.useCommand(CommandName.UPDATE_LANGUAGE)
const engineCommand = commandStore.useCommand(CommandName.CHOOSE_MAP_ENGINE)

const { isMobileScreen } = useResponsive()
const { available: feedbackAvailable } = useFeedback()
const shake = useShakeGesture(() => {})

/**
 * Turning the toggle on is the user gesture iOS needs to grant motion access,
 * so ask here rather than at app start. A denial flips the switch back — the
 * setting would otherwise read as on while nothing listens.
 */
async function toggleShakeForFeedback(enabled: boolean) {
  if (!enabled) {
    shakeForFeedback.value = false
    return
  }

  const state = await shake.requestPermission()
  shakeForFeedback.value = state === 'granted'
}
const projectionCommand = commandStore.useCommand(CommandName.MAP_PROJECTION)

const NORMAL_THRESHOLDS = [0.5, 0.3, 0.2, 0.15]
const EXTREME_THRESHOLDS = [0.15, 0.1, 0.05]
const percent = (level: number) => `${Math.round(level * 100)}%`
const lowBattery = computed(() => strongerSaver(power.choice, power.fromBattery) !== power.choice)

watch(
  () => ({
    language: deviceOnly.isDeviceOnly('account.language') ? undefined : (locale.value as Locale),
    unitSystem: deviceOnly.isDeviceOnly('account.unitSystem') ? undefined : unitSystem.value,
  }),
  updates => {
    if (!authStore.me || (!updates.language && !updates.unitSystem)) return
    updatePreferences(updates).catch(() => {
      // Ignore errors (e.g. network); local state is already updated
    })
  },
  { deep: true },
)
</script>

<template>
  <div class="flex flex-col gap-4 w-fit items-start">
    <!-- Language preference -->
    <SettingsSection
      id="language"
      :title="$t('settings.behavior.language.title')"
    >
      <SettingsItem
        v-if="languageCommand"
        :title="languageCommand.name"
        sync-key="account.language"
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

    <!-- Map behavior: engine, projection, rotation -->
    <SettingsSection
      id="map-behavior"
      :title="$t('settings.behavior.mapBehavior.title')"
    >
      <SettingsItem
        v-if="engineCommand"
        :title="engineCommand.name"
        :description="engineCommand.description"
        :icon="engineCommand.icon"
        :command-id="CommandName.CHOOSE_MAP_ENGINE"
      >
        <Select
          :model-value="settings.engine"
          @update:model-value="
            value => mapService.setMapEngine(value as MapEngine)
          "
        >
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="argumentOption in commandStore.getCommandArgumentOptions(
                  CommandName.CHOOSE_MAP_ENGINE,
                  'engine',
                )"
                :value="argumentOption.value.toString()"
              >
                <span class="flex items-center gap-2">
                  {{ argumentOption.name }}
                  <Badge
                    v-if="argumentOption.premium"
                    variant="primary"
                    class="text-[10px] px-1.5 py-0"
                  >
                    Premium
                  </Badge>
                </span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>

      <SettingsItem
        v-if="projectionCommand"
        :title="projectionCommand.name"
        sync-key="app.map.projection"
        :description="projectionCommand.description"
        :icon="projectionCommand.icon"
        :command-id="CommandName.MAP_PROJECTION"
      >
        <Select
          :model-value="settings.projection"
          @update:model-value="
            mapService.setMapProjection($event as MapProjection)
          "
        >
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="argumentOption in commandStore.getCommandArgumentOptions(
                  CommandName.MAP_PROJECTION,
                  'projection',
                )"
                :value="argumentOption.value.toString()"
              >
                {{ argumentOption.name }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.rotation.northUpSnap')"
        sync-key="app.map.northUpSnap"
        :description="$t('settings.mapSettings.rotation.northUpSnapDescription')"
        :icon="CompassIcon"
      >
        <Switch
          :model-value="settings.northUpSnap !== false"
          @update:model-value="mapService.toggleNorthUpSnap()"
        />
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.rotation.gridSnap')"
        sync-key="app.map.gridSnapMode"
        :description="$t('settings.mapSettings.rotation.gridSnapDescription')"
        :icon="Grid2x2"
      >
        <Select
          :model-value="settings.gridSnapMode ?? GridSnapMode.NORTH_UP"
          @update:model-value="settings.gridSnapMode = $event as GridSnapMode"
        >
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="GridSnapMode.OFF">
                {{ $t('settings.mapSettings.rotation.gridSnapModeOff') }}
              </SelectItem>
              <SelectItem :value="GridSnapMode.NORTH_UP">
                {{ $t('settings.mapSettings.rotation.gridSnapModeNorthUp') }}
              </SelectItem>
              <SelectItem :value="GridSnapMode.ALL">
                {{ $t('settings.mapSettings.rotation.gridSnapModeAll') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>

    <!-- Location behavior -->
    <SettingsSection
      id="location"
      :title="$t('settings.mapSettings.location.title')"
    >
      <SettingsItem
        :title="$t('settings.mapSettings.location.startupLocation')"
        sync-key="app.map.startupLocation"
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
        sync-key="app.map.locateFlySpeed"
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
    <SettingsSection
      id="floor-numbering"
      :title="$t('settings.behavior.floorNumbering.title')"
    >
      <SettingsItem
        :title="$t('settings.behavior.floorNumbering.system')"
        sync-key="app.general.floorNumbering"
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
    <SettingsSection id="units" :title="$t('settings.behavior.units.title')">
      <SettingsItem
        :title="$t('settings.behavior.units.system')"
        sync-key="account.unitSystem"
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

    <SettingsSection
      id="battery-saver"
      :title="$t('settings.behavior.batterySaver.title')"
    >
      <SettingsItem
        :title="$t('settings.behavior.batterySaver.level')"
        :description="
          lowBattery
            ? $t('settings.behavior.batterySaver.lowBattery')
            : $t('settings.behavior.batterySaver.levelDescription')
        "
        :icon="LeafIcon"
      >
        <Select v-model="power.choice">
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem v-for="saver in POWER_SAVERS" :key="saver" :value="saver">
                {{ $t(`settings.behavior.batterySaver.values.${saver}`) }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>

      <template v-if="power.batterySupported">
        <SettingsItem
          :title="$t('settings.behavior.batterySaver.auto')"
          :description="$t('settings.behavior.batterySaver.autoDescription')"
          :icon="PlugZapIcon"
        >
          <Switch v-model="power.auto.enabled" />
        </SettingsItem>

        <template v-if="power.auto.enabled">
          <SettingsItem
            :title="$t('settings.behavior.batterySaver.normalAt')"
            :icon="BatteryLowIcon"
          >
            <Select
              :model-value="String(power.auto.normalAt)"
              @update:model-value="v => (power.auto.normalAt = Number(v))"
            >
              <SelectTrigger class="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem v-for="level in NORMAL_THRESHOLDS" :key="level" :value="String(level)">
                    {{ percent(level) }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsItem>

          <SettingsItem
            :title="$t('settings.behavior.batterySaver.extremeAt')"
            :icon="BatteryWarningIcon"
          >
            <Select
              :model-value="String(power.auto.extremeAt)"
              @update:model-value="v => (power.auto.extremeAt = Number(v))"
            >
              <SelectTrigger class="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem v-for="level in EXTREME_THRESHOLDS" :key="level" :value="String(level)">
                    {{ percent(level) }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsItem>
        </template>
      </template>
    </SettingsSection>

    <SettingsSection
      v-if="isMobileScreen"
      id="home-screen"
      :title="$t('settings.behavior.homeScreen.title')"
    >
      <SettingsItem
        :title="$t('settings.behavior.homeScreen.sheetStart')"
        sync-key="app.general.homeSheetStart"
        :icon="PanelBottom"
      >
        <Select v-model="homeSheetStart">
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="search">
                {{ $t('settings.behavior.homeScreen.search') }}
              </SelectItem>
              <SelectItem value="library">
                {{ $t('settings.behavior.homeScreen.library') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>

    <SettingsSection
      v-if="isMobileScreen && feedbackAvailable && shake.isSupported"
      id="feedback"
      :title="$t('feedback.title')"
    >
      <SettingsItem
        :title="$t('settings.behavior.shakeForFeedback.title')"
        :description="$t('settings.behavior.shakeForFeedback.description')"
        :icon="Smartphone"
      >
        <Switch
          :model-value="shakeForFeedback"
          @update:model-value="toggleShakeForFeedback"
        />
      </SettingsItem>
    </SettingsSection>
  </div>
</template>
