<script setup lang="ts">
import H3 from '@/components/ui/typography/H3.vue'
import H4 from '@/components/ui/typography/H4.vue'
import H5 from '@/components/ui/typography/H5.vue'
import H6 from '@/components/ui/typography/H6.vue'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import { SettingsIcon, PlusIcon } from 'lucide-vue-next'

import { layers } from '@/components/map/layers'
import { useMapStore } from '@/stores/map.store'
import { MapLibrary } from '@/types/map.types'

const mapStore = useMapStore()
</script>

<template>
  <div class="flex flex-col gap-4 w-fit items-start">
    <div>
      <H4>{{ $t('settings.mapData.library.title') }}</H4>
      <P>
        {{ $t('settings.mapData.library.description') }}
      </P>

      <RadioGroup
        :default-value="mapStore.mapLibrary"
        @update:model-value="(library) => mapStore.setMapLibrary(library as MapLibrary)"
      >
        <div class="flex items-center space-x-2">
          <RadioGroupItem id="mapbox" value="mapbox" />
          <Label for="mapbox">Mapbox</Label>
        </div>
        <div class="flex items-center space-x-2">
          <RadioGroupItem id="maplbire" value="maplibre" />
          <Label for="maplbire">MapLibre</Label>
        </div>
      </RadioGroup>
    </div>

    <div>
      <H4>{{ $t('settings.mapData.layers.title') }}</H4>
      <P>{{ $t('settings.mapData.layers.description') }}</P>

      <div
        class="flex flex-col gap-2 my-2"
        v-for="(layerType, i) in Object.values(layers)"
        :key="i"
      >
        <H6>{{ layerType.name }}</H6>

        <RadioGroup default-value="option-one" class="flex">
          <Card
            v-for="(layer, j) in layerType.layers"
            :key="j"
            class="flex items-center gap-2 px-2 py-1 dark:border-gray-700"
          >
            <RadioGroupItem :id="layerType.name" :value="layer.name" />
            <Label :for="layerType.name">{{ layer.name }}</Label>
            <Button variant="ghost" size="icon">
              <SettingsIcon class="size-4" />
            </Button>
          </Card>
        </RadioGroup>
      </div>
    </div>

    <Button variant="ghost">
      <PlusIcon class="size-4 mr-2" />
      Configure new layer
    </Button>
  </div>
</template>
