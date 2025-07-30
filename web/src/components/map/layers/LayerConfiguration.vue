<script setup lang="ts">
import {
  Layer,
  MapboxLayerType,
  SourceType,
  MapEngine,
  LayerType,
} from '@/types/map.types'
import { computed, ref, defineEmits, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { useMapStore } from '@/stores/map.store'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { IconPicker } from '@/components/ui/icon-picker'
import { Label } from '@/components/ui/label'
import * as LucideIcons from 'lucide-vue-next'
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { SettingsSection, SettingsItem } from '@/components/settings'

// Helper functions to convert between icon component and string name
function getIconStringFromComponent(iconComponent: any): string | null {
  if (!iconComponent) return null

  // Find the component name in LucideIcons
  for (const [name, component] of Object.entries(LucideIcons)) {
    if (component === iconComponent && name.endsWith('Icon')) {
      return name
    }
  }
  return null
}

function getIconComponentFromString(iconName: string): any {
  if (!iconName) return null

  const fullName = iconName.endsWith('Icon') ? iconName : `${iconName}Icon`

  const isValidIcon =
    fullName !== 'icons' &&
    typeof LucideIcons[fullName as keyof typeof LucideIcons] === 'function'

  return isValidIcon ? LucideIcons[fullName as keyof typeof LucideIcons] : null
}

const mapStore = useMapStore()

const props = defineProps<{
  layerId?: Layer['configuration']['id']
}>()

const editing = computed(() => props.layerId)
const layer = editing
  ? mapStore.layers.find(layer => layer.configuration.id === props.layerId)
  : null

const emit = defineEmits<{
  'update:valid': [valid: boolean]
  submit: [values: any]
}>()

const useExistingSource = ref(
  layer ? typeof layer.configuration.source === 'string' : false,
)

const getCustomConfigurationDefault = (layer: Layer | null) => {
  if (!layer) return '{}'

  const uiConfiguredFields = ['id', 'type', 'source']
  const sourceConfigFields = [
    'id',
    'type',
    'url',
    'tiles',
    'tileSize',
    'attribution',
  ]

  const config = { ...layer.configuration }

  // Remove top-level UI-configured fields
  uiConfiguredFields.forEach(field => {
    delete config[field]
  })

  // Handle source object separately
  if (config.source && typeof config.source === 'object') {
    sourceConfigFields.forEach(field => {
      delete config.source[field]
    })
  }

  return Object.keys(config).length > 0 ? JSON.stringify(config, null, 2) : '{}'
}

const layerSchema = computed(() => {
  return toTypedSchema(
    z.object({
      name: z.string().min(1, 'required').default(''),
      showInLayerSelector: z.boolean().default(true),
      // TODO: Add field for layer type
      type: z.nativeEnum(LayerType).default(LayerType.CUSTOM),
      visible: z.boolean().default(true),
      engine: z
        .array(z.enum([MapEngine.MAPBOX, MapEngine.MAPLIBRE]))
        .min(1)
        .default([MapEngine.MAPBOX, MapEngine.MAPLIBRE]),
      icon: z.any().default(() => null),
      customConfiguration: z
        .string()
        .refine(
          val => {
            try {
              if (val) JSON.parse(val)
              return true
            } catch {
              return false
            }
          },
          { message: 'Invalid JSON format' },
        )
        .default(() => (layer ? getCustomConfigurationDefault(layer) : '{}')),
      configuration: z
        .object({
          id: z.string().min(1, 'required').default(''),
          type: z
            .enum(Object.values(MapboxLayerType) as [string, ...string[]])
            .default(MapboxLayerType.LINE), // TODO: Not working
          source: useExistingSource.value
            ? z.string().default('')
            : z
                .object({
                  id: z.string().min(1, 'required').default(''),
                  type: z
                    .enum(Object.values(SourceType) as [string, ...string[]])
                    .default(SourceType.RASTER), // TODO: Not working
                  url: z.string().url().optional(),
                  tiles: z
                    .array(
                      z
                        .string()
                        .url('Must be a valid URL')
                        .regex(
                          /^https?:\/\/.*(?=.*\{x\})(?=.*\{y\})(?=.*\{z\}).*$/i,
                          'URL must contain {z}, {x}, and {y} parameters',
                        ),
                    )
                    .min(1, 'At least one tile URL is required')
                    .default([])
                    .optional(),
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

const { handleSubmit, errors, values, meta, setFieldValue, setFieldError } =
  useForm({
    validationSchema: layerSchema,
    initialValues: {
      ...layer,
      type: layer?.type || LayerType.CUSTOM,
      engine: layer?.engine || [MapEngine.MAPBOX, MapEngine.MAPLIBRE],
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

watch(
  () => values.customConfiguration,
  newValue => {
    try {
      const customConfig = JSON.parse(newValue || '{}')
      const mergedConfig = deepMerge(
        JSON.parse(JSON.stringify(values.configuration || {})),
        customConfig,
      )

      if (customConfig.source && values.configuration?.source) {
        mergedConfig.source = deepMerge(
          JSON.parse(JSON.stringify(values.configuration.source)),
          customConfig.source,
        )
      }

      setFieldValue('configuration', mergedConfig)
      setFieldError('customConfiguration', undefined)
    } catch (e) {
      setFieldError('customConfiguration', 'Invalid JSON format')
    }
  },
)

const deepMerge = (target: any, source: any) => {
  if (!source) return target
  if (!target) return source

  for (const key in source) {
    if (source[key] instanceof Object && !Array.isArray(source[key])) {
      target[key] = deepMerge(
        Object.prototype.hasOwnProperty.call(target, key) ? target[key] : {},
        source[key],
      )
    } else {
      target[key] = source[key]
    }
  }
  return target
}

defineExpose({
  submit: onSubmit,
})
</script>

<template>
  <!-- TODO: Add FormMessage for errors -->
  <form @submit="onSubmit" class="space-y-4">
    <SettingsSection
      :title="$t('layers.meta.title')"
      :frame="false"
      :shadow="false"
    >
      <FormField name="showInLayerSelector" v-slot="{ value, handleChange }">
        <FormItem>
          <SettingsItem :title="$t('layers.meta.fields.showInLayerSelector')">
            <FormControl>
              <Switch :model-value="value" @update:model-value="handleChange" />
            </FormControl>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="name" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem :title="$t('layers.meta.fields.name')">
            <div class="flex flex-col gap-1.5">
              <FormControl>
                <Input
                  v-bind="componentField"
                  :placeholder="$t('layers.meta.fields.name')"
                  class="w-fit"
                />
              </FormControl>
            </div>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="icon" v-slot="{ value, handleChange }">
        <FormItem>
          <SettingsItem :title="$t('layers.meta.fields.icon')">
            <FormControl>
              <IconPicker
                :model-value="{
                  icon: getIconStringFromComponent(value) || 'Layers3Icon',
                  color: 'blue',
                }"
                @update:model-value="
                  newValue => {
                    const iconComponent = getIconComponentFromString(
                      newValue.icon,
                    )
                    handleChange(iconComponent)
                  }
                "
                :placeholder="$t('layers.meta.fields.iconPlaceholder')"
              />
            </FormControl>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="configuration.id" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem :title="$t('layers.meta.fields.id')">
            <div class="flex flex-col gap-1.5">
              <FormControl>
                <Input
                  v-bind="componentField"
                  :placeholder="$t('layers.meta.fields.id')"
                  class="w-fit"
                />
              </FormControl>
            </div>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="configuration.type" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem :title="$t('layers.meta.fields.type.title')">
            <FormControl>
              <Select v-bind="componentField">
                <SelectTrigger class="w-fit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="type in Object.values(MapboxLayerType)"
                    :key="type"
                    :value="type"
                  >
                    {{ $t(`layers.meta.fields.type.values.${type}`) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormControl>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="engine" v-slot="{ value, handleChange }">
        <FormItem>
          <SettingsItem :title="$t('layers.meta.fields.engine')">
            <div class="flex flex-col gap-2">
              <div class="flex items-center space-x-2">
                <Checkbox
                  :model-value="value.includes(MapEngine.MAPBOX)"
                  @update:model-value="
                    checked => {
                      const newValue = checked
                        ? [...value, MapEngine.MAPBOX]
                        : value.filter(v => v !== MapEngine.MAPBOX)
                      handleChange(newValue)
                    }
                  "
                />
                <Label>Mapbox</Label>
              </div>
              <div class="flex items-center space-x-2">
                <Checkbox
                  :model-value="value.includes(MapEngine.MAPLIBRE)"
                  @update:model-value="
                    checked => {
                      const newValue = checked
                        ? [...value, MapEngine.MAPLIBRE]
                        : value.filter(v => v !== MapEngine.MAPLIBRE)
                      handleChange(newValue)
                    }
                  "
                />
                <Label>Maplibre</Label>
              </div>
            </div>
          </SettingsItem>
        </FormItem>
      </FormField>
    </SettingsSection>

    <SettingsSection
      :title="$t('layers.configuration.title')"
      class="mt-4"
      :frame="false"
      :shadow="false"
    >
      <SettingsItem :title="$t('layers.configuration.fields.useExisting')">
        <Switch disabled></Switch>
      </SettingsItem>

      <template v-if="useExistingSource">
        <SettingsItem :title="$t('layers.configuration.fields.id')">
          <Select>
            <SelectTrigger class="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent> </SelectContent>
          </Select>
        </SettingsItem>
      </template>

      <template v-else>
        <FormField name="configuration.source.id" v-slot="{ componentField }">
          <FormItem>
            <SettingsItem :title="$t('layers.configuration.fields.id')">
              <div class="flex flex-col gap-1.5">
                <FormControl>
                  <Input
                    v-bind="componentField"
                    :placeholder="$t('layers.configuration.fields.id')"
                    class="w-fit"
                  />
                </FormControl>
              </div>
            </SettingsItem>
          </FormItem>
        </FormField>

        <FormField name="configuration.source.type" v-slot="{ componentField }">
          <FormItem>
            <SettingsItem :title="$t('layers.configuration.fields.type')">
              <FormControl>
                <Select v-bind="componentField">
                  <SelectTrigger class="w-fit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="raster">
                      {{ $t('layers.configuration.fields.values.raster') }}
                    </SelectItem>
                    <SelectItem value="vector">
                      {{ $t('layers.configuration.fields.values.vector') }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
            </SettingsItem>
          </FormItem>
        </FormField>

        <SettingsItem
          :title="$t('layers.configuration.fields.tileConfiguration.title')"
        >
          <Select v-model="tileConfig">
            <SelectTrigger class="w-fit">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tilejson">{{
                $t(
                  'layers.configuration.fields.tileConfiguration.values.tilejson',
                )
              }}</SelectItem>
              <SelectItem value="custom">{{
                $t(
                  'layers.configuration.fields.tileConfiguration.values.custom',
                )
              }}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsItem>

        <template v-if="tileConfig === 'custom'">
          <FormField
            name="configuration.source.tiles"
            v-slot="{ componentField }"
          >
            <FormItem>
              <SettingsItem :title="$t('layers.configuration.fields.tiles')">
                <div class="flex flex-col gap-2 w-full">
                  <template v-for="(tile, index) in tileInputs" :key="index">
                    <Input
                      v-model="tileInputs[index]"
                      @input="handleNewTileInput()"
                      class="w-full max-w-80 self-end"
                      :placeholder="
                        $t('layers.configuration.fields.tileUrlPlaceholder', {
                          0: index + 1,
                        })
                      "
                    />
                  </template>
                </div>
              </SettingsItem>
            </FormItem>
          </FormField>

          <FormField
            name="configuration.source.tileSize"
            v-slot="{ componentField }"
          >
            <FormItem>
              <SettingsItem :title="$t('layers.configuration.fields.tileSize')">
                <Input
                  v-bind="componentField"
                  type="number"
                  :placeholder="$t('layers.configuration.fields.tileSize')"
                  class="w-fit"
                />
              </SettingsItem>
            </FormItem>
          </FormField>

          <SettingsItem
            :title="$t('layers.configuration.fields.attribution.title')"
            block
          >
            <div class="flex flex-col gap-2">
              <Input
                v-model="attributionUrl"
                :placeholder="$t('layers.configuration.fields.attribution.url')"
                class="w-fit"
              />
              <Input
                v-model="attributionName"
                :placeholder="
                  $t('layers.configuration.fields.attribution.name')
                "
                class="w-fit"
              />
            </div>
          </SettingsItem>
        </template>

        <template v-else>
          <FormField
            name="configuration.configuration.url"
            v-slot="{ componentField }"
          >
            <FormItem>
              <SettingsItem :title="$t('layers.configuration.fields.url')">
                <Input
                  v-bind="componentField"
                  type="text"
                  :placeholder="$t('layers.configuration.fields.url')"
                  class="w-fit"
                />
              </SettingsItem>
            </FormItem>
          </FormField>
        </template>
      </template>

      <FormField name="customConfiguration" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem
            :title="$t('layers.meta.fields.customConfiguration.title')"
            block
          >
            <div class="flex-1 flex flex-col gap-2 items-end">
              <FormControl>
                <Textarea
                  v-bind="componentField"
                  rows="10"
                  :placeholder="
                    $t('layers.meta.fields.customConfiguration.placeholder')
                  "
                  class="font-mono"
                />
              </FormControl>
              <FormMessage />
            </div>
          </SettingsItem>
        </FormItem>
      </FormField>
    </SettingsSection>
  </form>
</template>
