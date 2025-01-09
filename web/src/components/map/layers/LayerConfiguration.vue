<script setup lang="ts">
import { Source, Layer, LayerType, SourceType } from '@/types/map.types'
import { computed, ref, defineEmits, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { useMapStore } from '@/stores/map.store'
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
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

const mapStore = useMapStore()

const props = defineProps<{
  layerId?: Layer['id']
}>()

const editing = computed(() => props.layerId)
const layer = editing
  ? mapStore.layers.find(layer => layer.id === props.layerId)
  : null

const emit = defineEmits<{
  'update:valid': [valid: boolean]
  submit: [values: any]
}>()

const useExistingSource = ref(
  layer ? typeof layer.configuration.source === 'string' : false,
)

const layerSchema = computed(() => {
  return toTypedSchema(
    z.object({
      name: z.string().min(1, 'required').default(''),
      id: z.string().min(1, 'required').default(''),
      enabled: z.boolean().default(true),
      configuration: z
        .object({
          type: z
            .enum(Object.values(LayerType) as [string, ...string[]])
            .default('line'),
          source: useExistingSource.value
            ? z.string().default('')
            : z
                .object({
                  type: z
                    .enum(Object.values(SourceType) as [string, ...string[]])
                    .default('raster'),
                  url: z.string().url().optional(),
                  tiles: z.array(z.string()).optional(),
                  tileSize: z.number().positive().optional(),
                  attribution: z.string().optional(),
                })
                .default({}),
        })
        .passthrough()
        .default({}),
    }),
  )
})

const { handleSubmit, errors, values, meta, setFieldValue } = useForm({
  validationSchema: layerSchema,
  initialValues: {
    ...layer,
    configuration: layer?.configuration || {},
  },
})

const onSubmit = handleSubmit(values => {
  if (editing.value) {
    mapStore.updateLayer(values as Layer)
  } else {
    mapStore.addLayer(values as Layer)
  }
})

const form = ref({
  ...layer,
})

const attributionUrl = ref('')
const attributionName = ref('')

const combinedAttribution = computed(() => {
  return `<a href="${attributionUrl.value}">© ${attributionName.value}</a>`
})

interface SourceConfig {
  type?: string
  url?: string
  tiles?: string[]
  tileSize?: number
  attribution?: string
}

const getSourceConfig = (): SourceConfig | null => {
  if (!form.value?.configuration?.source) return null
  return typeof form.value.configuration.source === 'object'
    ? (form.value.configuration.source as SourceConfig)
    : null
}

const initializeAttribution = () => {
  const sourceConfig = getSourceConfig()
  if (sourceConfig?.attribution) {
    const attributionMatch = sourceConfig.attribution.match(
      /<a href="([^"]+)">([^<]+)<\/a>/,
    )
    if (attributionMatch) {
      attributionUrl.value = attributionMatch[1]
      attributionName.value = attributionMatch[2].replace(/^©\s*/, '')
    }
  }
}

initializeAttribution()

const tileConfig = ref(
  useExistingSource.value
    ? 'custom'
    : typeof layer?.configuration.source === 'object' &&
      layer?.configuration.source.url
    ? 'tilejson'
    : 'custom',
)
const tileInputs = ref(
  useExistingSource.value
    ? []
    : [
        ...(typeof layer?.configuration.source === 'object'
          ? layer?.configuration.source.tiles || []
          : []),
        '',
      ],
)

const handleNewTileInput = () => {
  const tiles = tileInputs.value.filter(tile => tile !== '')
  const sourceConfig = getSourceConfig()
  if (!useExistingSource.value && typeof sourceConfig) {
    setFieldValue('configuration.source.tiles', tiles)
  }
  tileInputs.value = [...tiles, '']
}

watch(
  () => meta.value.valid,
  valid => {
    emit('update:valid', valid)
  },
  { immediate: true },
)

watch([attributionUrl, attributionName], () => {
  if (
    !useExistingSource.value &&
    typeof values.configuration?.source === 'object' &&
    (attributionUrl.value || attributionName.value)
  ) {
    setFieldValue('configuration.source.attribution', combinedAttribution.value)
  }
})

defineExpose({
  submit: onSubmit,
})
</script>

<template>
  <!-- TODO: Add FormMessage for errors -->
  <form @submit="onSubmit" class="space-y-4">
    <SettingsSection
      :title="$t('layers.info.title')"
      :frame="false"
      :shadow="false"
    >
      <FormField name="enabled" v-slot="{ value, handleChange }">
        <FormItem>
          <SettingsItem :title="$t('layers.info.fields.enabled')">
            <FormControl>
              <Switch :checked="value" @update:checked="handleChange" />
            </FormControl>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="name" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem :title="$t('layers.info.fields.name')">
            <div class="flex flex-col gap-1.5">
              <FormControl>
                <Input
                  v-bind="componentField"
                  :placeholder="$t('layers.info.fields.name')"
                  class="w-fit"
                />
              </FormControl>
            </div>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="id" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem :title="$t('layers.info.fields.id')">
            <div class="flex flex-col gap-1.5">
              <FormControl>
                <Input
                  v-bind="componentField"
                  :placeholder="$t('layers.info.fields.id')"
                  class="w-fit"
                />
              </FormControl>
            </div>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="type" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem :title="$t('layers.info.fields.type.title')">
            <FormControl>
              <Select v-bind="componentField">
                <SelectTrigger class="w-fit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="type in Object.values(LayerType)"
                    :key="type"
                    :value="type"
                  >
                    {{ $t(`layers.info.fields.type.values.${type}`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormControl>
          </SettingsItem>
        </FormItem>
      </FormField>
    </SettingsSection>

    <SettingsSection
      :title="$t('layers.source.title')"
      class="mt-4"
      :frame="false"
      :shadow="false"
    >
      <SettingsItem :title="$t('layers.source.fields.useExisting')">
        <Switch disabled></Switch>
      </SettingsItem>

      <template v-if="useExistingSource">
        <SettingsItem :title="$t('layers.source.fields.id')">
          <Select>
            <SelectTrigger class="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent> </SelectContent>
          </Select>
        </SettingsItem>
      </template>

      <template v-else>
        <FormField name="source.id" v-slot="{ componentField }">
          <FormItem>
            <SettingsItem :title="$t('layers.source.fields.id')">
              <div class="flex flex-col gap-1.5">
                <FormControl>
                  <Input
                    v-bind="componentField"
                    :placeholder="$t('layers.source.fields.id')"
                    class="w-fit"
                  />
                </FormControl>
              </div>
            </SettingsItem>
          </FormItem>
        </FormField>

        <FormField name="source.type" v-slot="{ componentField }">
          <FormItem>
            <SettingsItem :title="$t('layers.source.fields.type')">
              <FormControl>
                <Select v-bind="componentField">
                  <SelectTrigger class="w-fit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="raster">{{
                      $t('layers.source.fields.values.raster')
                    }}</SelectItem>
                    <SelectItem value="vector">{{
                      $t('layers.source.fields.values.vector')
                    }}</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
            </SettingsItem>
          </FormItem>
        </FormField>

        <SettingsItem
          :title="$t('layers.source.fields.tileConfiguration.title')"
        >
          <Select v-model="tileConfig">
            <SelectTrigger class="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tilejson">{{
                $t('layers.source.fields.tileConfiguration.values.tilejson')
              }}</SelectItem>
              <SelectItem value="custom">{{
                $t('layers.source.fields.tileConfiguration.values.custom')
              }}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsItem>

        <template v-if="tileConfig === 'custom'">
          <FormField name="source.tiles" v-slot="{ componentField }">
            <FormItem>
              <SettingsItem :title="$t('layers.source.fields.tiles')">
                <div class="flex flex-col gap-2 w-full">
                  <template v-for="(tile, index) in tileInputs" :key="index">
                    <Input
                      v-model="tileInputs[index]"
                      @input="handleNewTileInput()"
                      class="w-full max-w-80 self-end"
                      :placeholder="
                        $t('layers.source.fields.tileUrlPlaceholder', {
                          0: index + 1,
                        })
                      "
                    />
                  </template>
                </div>
              </SettingsItem>
            </FormItem>
          </FormField>

          <FormField name="source.tileSize" v-slot="{ componentField }">
            <FormItem>
              <SettingsItem :title="$t('layers.source.fields.tileSize')">
                <Input
                  v-bind="componentField"
                  type="number"
                  :placeholder="$t('layers.source.fields.tileSize')"
                  class="w-fit"
                />
              </SettingsItem>
            </FormItem>
          </FormField>

          <SettingsItem :title="$t('layers.source.fields.attribution.title')">
            <div class="flex flex-col gap-2">
              <Input
                v-model="attributionUrl"
                :placeholder="$t('layers.source.fields.attribution.url')"
                class="w-fit"
              />
              <Input
                v-model="attributionName"
                :placeholder="$t('layers.source.fields.attribution.name')"
                class="w-fit"
              />
            </div>
          </SettingsItem>
        </template>

        <template v-else>
          <FormField name="source.url" v-slot="{ componentField }">
            <FormItem>
              <SettingsItem :title="$t('layers.source.fields.url')">
                <Input
                  v-bind="componentField"
                  type="text"
                  :placeholder="$t('layers.source.fields.url')"
                  class="w-fit"
                />
              </SettingsItem>
            </FormItem>
          </FormField>
        </template>
      </template>
    </SettingsSection>

    <SettingsSection
      :title="$t('layers.configuration.title')"
      :frame="false"
      :shadow="false"
    >
      <FormField name="configuration" v-slot="{ componentField }">
        <FormItem>
          <FormControl>
            <Textarea
              v-bind="componentField"
              rows="10"
              :placeholder="$t('layers.configuration.fields.placeholder')"
            />
          </FormControl>
        </FormItem>
      </FormField>
    </SettingsSection>
  </form>
</template>
