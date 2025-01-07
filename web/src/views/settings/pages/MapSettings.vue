<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAppService } from '@/services/app.service'
import { useMapStore } from '@/stores/map.store'
import { useCommandStore } from '@/stores/command.store'
import { useI18n } from 'vue-i18n'
import { type Layer, MapEngine } from '@/types/map.types'

import { H6 } from '@/components/ui/typography'
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
import { Card } from '@/components/ui/card'
import { SettingsIcon, PlusIcon } from 'lucide-vue-next'
import LayerConfiguration from '@/components/map/layers/LayerConfiguration.vue'
import Layers from '@/components/map/Layers.vue'

const { mapEngine, setMapEngine, layers } = useMapStore()
const commandStore = useCommandStore()
const appService = useAppService()
const { t } = useI18n()

const projectionLocal = localStorage.getItem('projection') || 'globe'
const projection = ref(projectionLocal)

watch(projection, value => {
  localStorage.setItem('projection', value)
  window.location.reload()
})

function openLayerConfigDialog(layer: Layer) {
  appService.componentDialog({
    component: LayerConfiguration,
    continueText: t('general.save'),
    props: {
      layer,
    },
  })
}
</script>

<template>
  <div class="flex flex-col gap-4 w-fit items-start">
    <!-- Map configuration -->
    <SettingsSection :title="$t('settings.mapSettings.engine.title')">
      <SettingsItem
        :title="$t('palette.commands.chooseMapEngine.name')"
        :description="$t('palette.commands.chooseMapEngine.description')"
      >
        <Select
          :default-value="mapEngine"
          @update:model-value="(engine) => setMapEngine(engine as MapEngine)"
        >
          <SelectTrigger class="w-fit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="argumentOption in commandStore.getCommandArgumentOptions(
                  'chooseMapEngine',
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

      <SettingsItem title="Map projection" v-if="mapEngine === 'mapbox'">
        <Select v-model="projection">
          <SelectTrigger class="w-fit">
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="globe">Globe</SelectItem>
              <SelectItem value="mercator">Mercator</SelectItem>
              <SelectItem value="equirectangular"> Equirectangular </SelectItem>
              <SelectItem value="equalEarth">Equal Earth</SelectItem>
              <SelectItem value="naturalEarth">Natural Earth</SelectItem>
              <SelectItem value="winkelTripel">Winkel Tripel</SelectItem>
              <SelectItem value="albers">Albers</SelectItem>
              <SelectItem value="lambertConformalConic">
                Lambert Conformal Conic
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select></SettingsItem
      >
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
        <Button variant="outline" @click="openLayerConfigDialog" disabled>
          <PlusIcon class="size-4 mr-2" />
          Configure new layer
        </Button>
      </template>

      <Layers />
    </SettingsSection>
  </div>
</template>
