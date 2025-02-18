<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useAppService } from '@/services/app.service'
import { useMapService } from '@/services/map.service'
import { useMapStore } from '@/stores/map.store'
import { useCommandStore } from '@/stores/command.store'
import { type Layer, MapEngine, MapProjection } from '@/types/map.types'
import { CommandName } from '@/stores/command.store'

import { Button } from '@/components/ui/button'
import { SettingsSection, SettingsItem } from '@/components/settings'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  MountainSnowIcon,
  PlusIcon,
  Building2Icon,
  MapIcon,
  MilestoneIcon,
  InfoIcon,
  TrainIcon,
  MapPinIcon,
} from 'lucide-vue-next'
import LayerConfiguration from '@/components/map/layers/LayerConfiguration.vue'
import Layers from '@/components/map/Layers.vue'

const mapStore = useMapStore()
const commandStore = useCommandStore()
const appService = useAppService()
const mapService = useMapService()
const { t } = useI18n()

const {
  mapEngine,
  map3dTerrain,
  map3dBuildings,
  mapPoiLabels,
  mapRoadLabels,
  mapTransitLabels,
  mapPlaceLabels,
} = storeToRefs(mapStore)

const engineCommand = commandStore.useCommand(CommandName.CHOOSE_MAP_ENGINE)
const projectionCommand = commandStore.useCommand(CommandName.MAP_PROJECTION)

function openLayerConfigDialog(layer: Layer) {
  appService.componentDialog({
    component: LayerConfiguration,
    continueText: t('general.save'),
    props: {
      layer,
    },
  })
}

const basemap = computed(() => {
  return mapStore.mapEngine === MapEngine.MAPBOX
    ? 'mapbox-standard'
    : 'maptiler'
})
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
          v-model="mapEngine"
          @update:model-value="(value) => mapService.setMapEngine(value as MapEngine)"
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
          :model-value="mapStore.mapProjection"
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
        :title="$t('settings.mapSettings.configuration.3dTerrain')"
        :icon="MountainSnowIcon"
      >
        <Switch :checked="map3dTerrain" @click="mapService.toggle3dTerrain()" />
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.configuration.3dBuildings')"
        :icon="Building2Icon"
      >
        <Switch
          disabled
          :checked="map3dBuildings"
          @click="mapService.toggle3dBuildings()"
        />
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.configuration.poiLabels')"
        :icon="InfoIcon"
      >
        <Switch :checked="mapPoiLabels" @click="mapService.togglePoiLabels()" />
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.configuration.roadLabels')"
        :icon="MilestoneIcon"
      >
        <Switch
          :checked="mapRoadLabels"
          @click="mapService.toggleRoadLabels()"
        />
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.configuration.transitLabels')"
        :icon="TrainIcon"
      >
        <Switch
          :checked="mapTransitLabels"
          @click="mapService.toggleTransitLabels()"
        />
      </SettingsItem>

      <SettingsItem
        :title="$t('settings.mapSettings.configuration.placeLabels')"
        :icon="MapPinIcon"
      >
        <Switch
          :checked="mapPlaceLabels"
          @click="mapService.togglePlaceLabels()"
        />
      </SettingsItem>
    </SettingsSection>

    <SettingsSection :title="$t('settings.mapSettings.basemaps.title')">
      <template v-slot:actions>
        <Button disabled variant="outline" @click="openLayerConfigDialog">
          <PlusIcon class="size-4 mr-2" />
          {{ $t('settings.mapSettings.basemaps.new') }}
        </Button>
      </template>

      <SettingsItem :title="$t('settings.mapSettings.basemaps.basemap')">
        <Select disabled v-model="basemap">
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mapbox-standard">Mapbox Standard</SelectItem>
            <SelectItem value="maptiler">Maptiler</SelectItem>
          </SelectContent>
        </Select>
      </SettingsItem>
    </SettingsSection>

    <!-- Data sources configuration -->
    <!-- <SettingsSection :title="$t('settings.mapSettings.dataSources.title')">
    </SettingsSection> -->

    <!-- Layers configuration -->
    <SettingsSection
      :title="$t('settings.mapSettings.layers.title')"
      :description="$t('settings.mapSettings.layers.description')"
      :frame="false"
    >
      <template v-slot:actions>
        <Button variant="outline" @click="openLayerConfigDialog">
          <PlusIcon class="size-4 mr-2" />
          {{ $t('settings.mapSettings.layers.new') }}
        </Button>
      </template>

      <Layers />
    </SettingsSection>
  </div>
</template>
