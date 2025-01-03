<script setup lang="ts">
import H4 from '@/components/ui/typography/H4.vue'
import H6 from '@/components/ui/typography/H6.vue'
import P from '@/components/ui/typography/P.vue'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsItem } from '@/components/settings'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import { Card } from '@/components/ui/card'
import { SettingsIcon, PlusIcon } from 'lucide-vue-next'

import { layers } from '@/components/map/layers'
import { useMapStore } from '@/stores/map.store'
import { useCommandStore } from '@/stores/command.store'
import { MapEngine } from '@/types/map.types'

const mapStore = useMapStore()
const commandStore = useCommandStore()
</script>

<template>
  <div class="flex flex-col gap-4 w-fit items-start">
    <SettingsCard :title="$t('settings.mapSettings.engine.title')">
      <SettingsItem
        :title="$t('palette.commands.chooseMapEngine.name')"
        :description="$t('palette.commands.chooseMapEngine.description')"
      >
        <Select
          :default-value="mapStore.mapEngine"
          @update:model-value="(engine) => mapStore.setMapEngine(engine as MapEngine)"
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
    </SettingsCard>

    <SettingsCard
      :title="$t('settings.mapSettings.layers.title')"
      :description="$t('settings.mapSettings.layers.description')"
    >
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

      <Button variant="ghost">
        <PlusIcon class="size-4 mr-2" />
        Configure new layer
      </Button>
    </SettingsCard>
  </div>
</template>
