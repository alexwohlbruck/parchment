<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Span } from '@/components/ui/typography'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  CheckIcon,
  MountainSnowIcon,
  Building2Icon,
  MapIcon,
  MilestoneIcon,
  InfoIcon,
  TrainIcon,
  MapPinIcon,
  RouteIcon,
} from 'lucide-vue-next'
import { useThemeStore, allColors } from '@/stores/theme.store'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map.service'
import { MapEngine, type MapStyleId } from '@/types/map.types'
import { palette } from '@/lib/palette'
import type { PaletteColor } from '@/lib/palette'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { SettingsSection, SettingsItem } from '@/components/settings'
import Layers from '@/components/map/Layers.vue'

const mapTheme = ref('auto')

// Theme store
const themeStore = useThemeStore()
const { isDark, accentColor, radius } = storeToRefs(themeStore)
const { toggleDark, setAccentColor, setRadius } = themeStore

// Map store
const mapStore = useMapStore()
const mapService = useMapService()
const { settings } = storeToRefs(mapStore)

const isMaplibre = computed(() => settings.value.engine === MapEngine.MAPLIBRE)

// Convert radius to slider format (array)
const sliderRadius = ref([radius.value])

// Keep sliderRadius in sync with radius from store
watch(radius, newValue => {
  sliderRadius.value = [newValue]
})

// Function to update radius when slider changes
const updateRadius = (value: number[] | undefined) => {
  if (value && value.length > 0) {
    setRadius(value[0])
  }
}

// Function to handle theme color selection
const handleColorChange = (value: any) => {
  setAccentColor(value as (typeof allColors)[number])
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection
      id="app-theme"
      :title="$t('settings.appearance.appTheme.title')"
    >
      <SettingsItem :title="$t('settings.appearance.appTheme.color.title')">
        <Select
          :model-value="accentColor"
          @update:model-value="handleColorChange"
        >
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="color in allColors"
                :key="color"
                :value="color"
              >
                <div class="flex items-center gap-2">
                  <div
                    class="w-2.5 h-2.5 rounded-full"
                    :style="{ backgroundColor: palette[color as PaletteColor]?.[500] }"
                  ></div>
                  <Span>{{
                    $t(`settings.appearance.appTheme.color.values.${color}`)
                  }}</Span>
                </div>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>

      <SettingsItem :title="$t('settings.appearance.appTheme.radius.title')">
        <div class="flex items-center gap-2">
          <Span class="text-sm text-muted-foreground font-medium">
            {{ sliderRadius[0] }}
          </Span>
          <Slider
            v-model="sliderRadius"
            class="w-48"
            :default-value="[0.5]"
            :max="1"
            :step="0.25"
            @update:model-value="updateRadius"
          />
        </div>
      </SettingsItem>

      <SettingsItem :title="$t('settings.appearance.appTheme.theme.title')">
        <Select
          :model-value="isDark ? 'dark' : 'light'"
          @update:model-value="value => toggleDark(value === 'dark')"
        >
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">
              {{ $t('settings.appearance.appTheme.theme.values.light') }}
            </SelectItem>
            <SelectItem value="dark">
              {{ $t('settings.appearance.appTheme.theme.values.dark') }}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>

    <SettingsSection
      id="map-theme"
      :title="$t('settings.appearance.mapTheme.title')"
    >
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

    <!-- Map configuration -->
    <SettingsSection
      id="configuration"
      :title="$t('settings.mapSettings.configuration.title')"
    >
      <SettingsItem
        :title="$t('settings.mapSettings.configuration.3dObjects')"
        :icon="Building2Icon"
      >
        <Switch
          :model-value="settings.objects3d"
          @update:model-value="mapService.toggle3dObjects()"
        />
      </SettingsItem>

      <SettingsItem
        v-if="settings.engine === MapEngine.MAPBOX"
        :title="$t('settings.mapSettings.configuration.3dTerrain')"
        :icon="MountainSnowIcon"
        :badge="$t('settings.mapSettings.configuration.experimental')"
      >
        <Switch
          :model-value="settings.terrain3d"
          @update:model-value="mapService.toggle3dTerrain()"
        />
      </SettingsItem>

      <SettingsItem
        v-if="settings.engine === MapEngine.MAPBOX"
        :title="$t('settings.mapSettings.configuration.hdRoads')"
        :description="
          $t('settings.mapSettings.configuration.hdRoadsDescription')
        "
        :icon="RouteIcon"
        :badge="$t('settings.mapSettings.configuration.experimental')"
      >
        <Switch
          :model-value="settings.hdRoads"
          @update:model-value="mapService.toggleHdRoads()"
        />
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.configuration.poiLabels')"
        :icon="InfoIcon"
      >
        <Switch
          :model-value="settings.poiLabels"
          @update:model-value="mapService.togglePoiLabels()"
        />
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.configuration.roadLabels')"
        :icon="MilestoneIcon"
      >
        <Switch
          :model-value="settings.roadLabels"
          @update:model-value="mapService.toggleRoadLabels()"
        />
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.configuration.transitLabels')"
        :icon="TrainIcon"
      >
        <Switch
          :model-value="settings.transitLabels"
          @update:model-value="mapService.toggleTransitLabels()"
        />
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.configuration.placeLabels')"
        :icon="MapPinIcon"
      >
        <Switch
          :model-value="settings.placeLabels"
          @update:model-value="mapService.togglePlaceLabels()"
        />
      </SettingsItem>
    </SettingsSection>

    <SettingsSection
      id="style"
      :title="$t('settings.mapSettings.style.title')"
    >
      <SettingsItem
        :title="$t('settings.mapSettings.style.mapStyle')"
        :description="
          isMaplibre
            ? $t('settings.mapSettings.style.descriptionMaplibre')
            : $t('settings.mapSettings.style.descriptionMapbox')
        "
        :icon="MapIcon"
      >
        <Select
          :model-value="
            isMaplibre ? settings.mapStyle : 'mapbox-standard'
          "
          :disabled="!isMaplibre"
          @update:model-value="
            v => mapStore.setMapStyle(v as MapStyleId)
          "
        >
          <SelectTrigger class="w-fit">
            <SelectValue :placeholder="$t('settings.mapSettings.style.placeholder')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-if="!isMaplibre" value="mapbox-standard">
              Mapbox Standard
            </SelectItem>
            <SelectItem value="osm-liberty">OSM Liberty</SelectItem>
            <SelectItem value="osm-openmaptiles">
              OSM OpenMapTiles
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>

    <!-- Layers configuration -->
    <Layers />
  </div>
</template>
