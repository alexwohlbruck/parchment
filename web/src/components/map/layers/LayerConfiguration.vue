<script setup lang="ts">
import { Source, type Layer } from '@/types/map.types'
import { computed, ref, defineEmits, watch } from 'vue'
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
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

const props = defineProps<{
  layer: Layer
}>()

const { layer } = props

const layerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  id: z.string().min(1, 'ID is required'),
  description: z.string().optional(),
  source: z.object({
    type: z.string().min(1, 'Source type is required'),
    url: z.string().url('Invalid URL'),
    tiles: z.array(z.string()).optional(),
    tileSize: z.number().optional(),
    attribution: z.string().optional(),
  }),
  meta: z.string().optional(),
})

const { handleSubmit, errors, meta } = useForm({
  validationSchema: toTypedSchema(layerSchema),
})

const form = ref({
  ...layer,
})

const attributionUrl = ref('')
const attributionName = ref('')

const combinedAttribution = computed(() => {
  return `<a href="${attributionUrl.value}">© ${attributionName.value}</a>`
})

const initializeAttribution = () => {
  if (typeof form.value.source === 'object' && form.value.source.attribution) {
    const attributionMatch = form.value.source.attribution.match(
      /<a href="([^"]+)">([^<]+)<\/a>/,
    )
    if (attributionMatch) {
      attributionUrl.value = attributionMatch[1]
      attributionName.value = attributionMatch[2].replace(/^©\s*/, '')
    }
  }
}

initializeAttribution()

const useExisting = ref(typeof form.value.source === 'string')
const tileConfig = ref(
  useExisting.value
    ? 'custom'
    : (form.value.source as Source).url
    ? 'tilejson'
    : 'custom',
)
const tileInputs = ref(
  useExisting.value ? [] : [...((form.value.source as Source).tiles || []), ''],
)

const handleNewTileInput = () => {
  const tiles = tileInputs.value.filter(tile => tile !== '')
  if (typeof form.value.source !== 'string') {
    form.value.source.tiles = tiles
  }
  tileInputs.value = [...tiles, '']
}
</script>

<template>
  <form @submit.prevent class="space-y-4">
    <SettingsSection
      title="Layer info"
      class="mt-4"
      :frame="false"
      :shadow="false"
    >
      <SettingsItem :title="$t('layers.fields.enabled')">
        <Switch v-model:checked="form.enabled"></Switch>
      </SettingsItem>

      <SettingsItem :title="$t('layers.fields.name')">
        <Input v-model="form.name" placeholder="Layer Name" class="w-fit" />
      </SettingsItem>

      <SettingsItem :title="$t('layers.fields.id')">
        <Input v-model="form.id" placeholder="Layer ID" class="w-fit" />
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
        <Switch v-model:checked="useExisting" disabled></Switch>
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
            v-model="(form.source as Source).id"
            placeholder="Source ID"
            class="w-fit"
          />
        </SettingsItem>

        <SettingsItem title="Source Type">
          <Select v-model="(form.source as Source).type">
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
          <Select v-model="tileConfig">
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
              v-model="(form.source as Source).tileSize"
              type="number"
              placeholder="Tile Size"
              class="w-fit"
            />
          </SettingsItem>

          <SettingsItem title="Attribution">
            <div class="flex flex-col gap-2">
              <Input
                v-model="attributionUrl"
                placeholder="Attribution URL"
                class="w-fit"
              />
              <Input
                v-model="attributionName"
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
              v-model="(form.source as Source).url"
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
        v-model="form.meta"
        rows="10"
        placeholder="Enter JSON for meta field"
      ></Textarea>
    </SettingsSection>
  </form>
</template>
