<script setup lang="ts">
import { type Layer } from '@/types/map.types'
import { computed, ref } from 'vue'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select'
import { SettingsSection, SettingsItem } from '@/components/settings'

const props = defineProps<{
  layer: Layer
}>()

const layerData = ref(props.layer)

const attributionUrl = ref('')
const attributionName = ref('')

const combinedAttribution = computed(() => {
  return `<a href="${attributionUrl.value}">© ${attributionName.value}</a>`
})

const initializeAttribution = () => {
  const attributionMatch = layerData.value.source.attribution?.match(
    /<a href="([^"]+)">([^<]+)<\/a>/,
  )
  if (attributionMatch) {
    attributionUrl.value = attributionMatch[1]
    attributionName.value = attributionMatch[2].replace(/^©\s*/, '')
  }
}

initializeAttribution()

const updateLayer = () => {
  try {
    props.layer.meta = JSON.parse(layerData.value.meta)
  } catch (error) {
    console.error('Invalid JSON format', error)
  }
  layerData.value.name = layerData.value.name
  layerData.value.enabled = layerData.value.enabled
  if (typeof layerData.value.source === 'string') {
    layerData.value.source = layerData.value.source
  } else {
    layerData.value.source.id = layerData.value.source.id
    layerData.value.source.type = layerData.value.source.type
    layerData.value.source.tiles = layerData.value.source.tiles
    layerData.value.source.url = layerData.value.source.url
    layerData.value.source.tileSize = layerData.value.source.tileSize
    layerData.value.source.attribution = combinedAttribution.value
  }
}

console.log(layerData.value.source)

const useExisting = ref(
  typeof layerData.value.source === 'string' ? true : false,
)
const tileConfig = ref(
  typeof layerData.value.source === 'string'
    ? 'custom'
    : layerData.value.source.url
    ? 'tilejson'
    : 'custom',
)
const tileInputs = ref(
  typeof layerData.value.source === 'string'
    ? []
    : [...(layerData.value.source.tiles || []), ''],
)

const handleNewTileInput = () => {
  const tiles = tileInputs.value.filter(tile => tile !== '')
  if (typeof layerData.value.source !== 'string') {
    layerData.value.source.tiles = tiles
  }
  tileInputs.value = [...tiles, '']
}
</script>

<template>
  <div>
    <SettingsSection
      title="Layer info"
      class="mt-4"
      :frame="false"
      :shadow="false"
    >
      <SettingsItem :title="$t('layers.fields.enabled')">
        <Switch
          v-model:checked="layerData.enabled"
          @change="updateLayer"
        ></Switch>
      </SettingsItem>

      <SettingsItem :title="$t('layers.fields.name')">
        <Input
          v-model="layerData.name"
          @blur="updateLayer"
          placeholder="Layer Name"
          class="w-fit"
        />
      </SettingsItem>

      <SettingsItem :title="$t('layers.fields.id')">
        <Input
          v-model="layerData.id"
          @blur="updateLayer"
          placeholder="Layer ID"
          class="w-fit"
        />
      </SettingsItem>

      <!-- TODO: Add icon field -->
    </SettingsSection>

    <SettingsSection
      title="Data source"
      class="mt-4"
      :frame="false"
      :shadow="false"
    >
      <SettingsItem title="Use existing source">
        <Switch
          v-model:checked="useExisting"
          @change="updateLayer"
          disabled
        ></Switch>
      </SettingsItem>

      <template v-if="useExisting">
        <SettingsItem title="Source ID">
          <Select>
            <SelectTrigger class="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent> </SelectContent>
          </Select>
        </SettingsItem>
      </template>

      <template v-else>
        <SettingsItem title="Source ID">
          <Input
            v-model="layerData.source.id"
            @blur="updateLayer"
            placeholder="Source ID"
            class="w-fit"
          />
        </SettingsItem>

        <SettingsItem title="Source Type">
          <Select v-model="layerData.source.type" @change="updateLayer">
            <SelectTrigger class="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="raster"> Raster </SelectItem>
              <SelectItem value="vector"> Vector </SelectItem>
            </SelectContent>
          </Select>
        </SettingsItem>

        <SettingsItem title="Tile Configuration">
          <Select v-model="tileConfig" @change="updateLayer">
            <SelectTrigger class="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tilejson">TileJSON</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </SettingsItem>

        <template v-if="tileConfig === 'custom'">
          <SettingsItem title="Tiles">
            <div class="flex flex-col gap-2">
              <template v-for="(tile, index) in tileInputs" :key="index">
                <!-- TODO: Add validation for URL inputs -->
                <Input
                  v-model="tileInputs[index]"
                  @input="handleNewTileInput()"
                  class="w-fit"
                  :placeholder="'Tile URL ' + (index + 1)"
                />
              </template>
            </div>
          </SettingsItem>

          <SettingsItem title="Tile Size">
            <Input
              v-model="layerData.source.tileSize"
              @blur="updateLayer"
              type="number"
              placeholder="Tile Size"
              class="w-fit"
            />
          </SettingsItem>

          <SettingsItem title="Attribution">
            <div class="flex flex-col gap-2">
              <Input
                v-model="attributionUrl"
                @input="updateLayer"
                placeholder="Attribution URL"
                class="w-fit"
              />
              <Input
                v-model="attributionName"
                @input="updateLayer"
                placeholder="Attribution name"
                class="w-fit"
              />
            </div>
          </SettingsItem>
        </template>

        <template v-else>
          <!-- TODO: Add TileJSON configuration -->
          <SettingsItem title="TileJSON URL">
            <Input
              v-model="layerData.source.url"
              @blur="updateLayer"
              type="text"
              placeholder="URL"
              class="w-fit"
            />
          </SettingsItem>
        </template>
      </template>
    </SettingsSection>

    <SettingsSection title="Custom configuration">
      <Textarea
        v-model="layerData.meta"
        @blur="updateLayer"
        rows="10"
        placeholder="Enter JSON for meta field"
      ></Textarea>
    </SettingsSection>
  </div>
</template>
