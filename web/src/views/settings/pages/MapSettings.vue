<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useAppService } from '@/services/app.service'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { useCommandStore } from '@/stores/command.store'
import {
  type Layer,
  type MapStyleId,
  MapEngine,
  MapProjection,
  ControlVisibility,
  UnitSystem,
} from '@/types/map.types'
import { CommandName } from '@/stores/command.store'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SettingsSection, SettingsItem } from '@/components/settings'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  MountainSnowIcon,
  PlusIcon,
  Building2Icon,
  MapIcon,
  MilestoneIcon,
  InfoIcon,
  TrainIcon,
  MapPinIcon,
  ZoomInIcon,
  CompassIcon,
  RulerIcon,
  PencilRulerIcon,
  PersonStandingIcon,
  LocateIcon,
  CloudSun,
  RouteIcon,
} from 'lucide-vue-next'
import Layers from '@/components/map/Layers.vue'

const mapStore = useMapStore()
const commandStore = useCommandStore()
const appService = useAppService()
const mapService = useMapService()
const { t } = useI18n()

const { settings, controlSettings } = storeToRefs(mapStore)

const engineCommand = commandStore.useCommand(CommandName.CHOOSE_MAP_ENGINE)
const projectionCommand = commandStore.useCommand(CommandName.MAP_PROJECTION)

const isMaplibre = computed(() => settings.value.engine === MapEngine.MAPLIBRE)
</script>

<template>
  <div class="flex flex-col gap-4 w-fit items-start">
    <!-- Map configuration -->
    <SettingsSection :title="$t('settings.mapSettings.configuration.title')">
      <SettingsItem
        v-if="engineCommand"
        :title="engineCommand.name"
        :description="engineCommand.description"
        :icon="engineCommand.icon"
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
                {{ argumentOption.name }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>

      <SettingsItem
        v-if="projectionCommand"
        :title="projectionCommand.name"
        :description="projectionCommand.description"
        :icon="projectionCommand.icon"
      >
        <Select
          :model-value="settings.projection"
          @update:model-value="
            mapService.setMapProjection($event as MapProjection)
          "
        >
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
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

    <!-- Map controls visibility -->
    <SettingsSection :title="$t('settings.mapSettings.controls.title')">
      <SettingsItem
        :title="$t('settings.mapSettings.controls.zoom')"
        :icon="ZoomInIcon"
      >
        <Select v-model="controlSettings.zoom">
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="ControlVisibility.ALWAYS">
                {{ $t('settings.mapSettings.controls.visibility.always') }}
              </SelectItem>
              <SelectItem :value="ControlVisibility.NEVER">
                {{ $t('settings.mapSettings.controls.visibility.never') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
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
                {{
                  $t('settings.mapSettings.controls.visibility.whileRotating')
                }}
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
                {{
                  $t('settings.mapSettings.controls.visibility.whileZooming')
                }}
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
        <Select v-model="controlSettings.locate">
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="ControlVisibility.ALWAYS">
                {{ $t('settings.mapSettings.controls.visibility.always') }}
              </SelectItem>
              <SelectItem :value="ControlVisibility.NEVER">
                {{ $t('settings.mapSettings.controls.visibility.never') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.controls.weather')"
        :icon="CloudSun"
      >
        <Select v-model="controlSettings.weather">
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="ControlVisibility.ALWAYS">
                {{ $t('settings.mapSettings.controls.visibility.always') }}
              </SelectItem>
              <SelectItem :value="ControlVisibility.NEVER">
                {{ $t('settings.mapSettings.controls.visibility.never') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.controls.toolbox')"
        :icon="PencilRulerIcon"
      >
        <Select
          :model-value="controlSettings.toolbox ?? ControlVisibility.ALWAYS"
          @update:model-value="
            v =>
              (controlSettings.toolbox =
                v === ControlVisibility.NEVER
                  ? ControlVisibility.NEVER
                  : ControlVisibility.ALWAYS)
          "
        >
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="ControlVisibility.ALWAYS">
                {{ $t('settings.mapSettings.controls.visibility.always') }}
              </SelectItem>
              <SelectItem :value="ControlVisibility.NEVER">
                {{ $t('settings.mapSettings.controls.visibility.never') }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>

    <SettingsSection :title="$t('settings.mapSettings.style.title')">
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

    <!-- Data sources configuration -->
    <!-- <SettingsSection :title="$t('settings.mapSettings.dataSources.title')">
    </SettingsSection> -->

    <!-- Layers configuration -->
    <Layers />
  </div>
</template>
