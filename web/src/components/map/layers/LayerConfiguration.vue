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
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

const props = defineProps<{
  layer: Layer
}>()

const { layer } = props

const emit = defineEmits<{
  submit: [values: z.infer<typeof layerSchema>]
  'update:valid': [valid: boolean]
}>()

const useExisting = ref(typeof layer.source === 'string')

const layerSchema = computed(() => {
  return toTypedSchema(
    z.object({
      name: z.string().min(1, 'required'),
      id: z.string().min(1, 'required'),
      description: z.string().optional(),
      enabled: z.boolean().default(true),
      source: useExisting.value
        ? z.string().min(1, 'required')
        : z.object({
            id: z.string().min(1, 'required'),
            type: z.enum(['raster', 'vector']),
            url: z.string().url('invalid').optional(),
            tiles: z
              .array(z.string().url('invalid'))
              .min(1, 'required')
              .optional(),
            tileSize: z.number().positive('invalid').optional(),
            attribution: z.string().optional(),
          }),
      meta: z.string().optional(),
    }),
  )
})

const { handleSubmit, errors, values, meta } = useForm({
  validationSchema: layerSchema,
  initialValues: {
    ...layer,
    meta:
      typeof layer.meta === 'string'
        ? layer.meta
        : JSON.stringify(layer.meta, null, 2),
  },
})

const onSubmit = handleSubmit(values => {
  const transformedValues = {
    ...values,
    source: useExisting.value
      ? (values.source as string)
      : {
          id: (values.source as Source).id,
          type: (values.source as Source).type,
          url: (values.source as Source).url,
          tiles: (values.source as Source).tiles,
          tileSize: (values.source as Source).tileSize,
          attribution: (values.source as Source).attribution,
        },
  }
  emit('submit', transformedValues)
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
  if (!useExisting.value && typeof values.source === 'object') {
    values.source.tiles = tiles
  }
  tileInputs.value = [...tiles, '']
}

// Watch for form validity changes and emit them
watch(
  () => meta.value.valid,
  valid => {
    emit('update:valid', valid)
  },
  { immediate: true },
)
</script>

<template>
  <!-- TODO: Add FormMessage for errors -->
  <pre>{{ errors }}</pre>
  <pre>{{ form }}</pre>
  <form @submit="onSubmit" class="space-y-4">
    <SettingsSection
      title="Layer info"
      class="mt-4"
      :frame="false"
      :shadow="false"
    >
      <FormField name="enabled" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem :title="$t('layers.fields.enabled')">
            <FormControl>
              <Switch
                v-bind="componentField"
                v-model:checked="values.enabled"
              />
            </FormControl>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="name" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem :title="$t('layers.fields.name')">
            <div class="flex flex-col gap-1.5">
              <FormControl>
                <Input
                  v-bind="componentField"
                  v-model="values.name"
                  placeholder="Layer Name"
                  class="w-fit"
                />
              </FormControl>
            </div>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="id" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem :title="$t('layers.fields.id')">
            <div class="flex flex-col gap-1.5">
              <FormControl>
                <Input
                  v-bind="componentField"
                  v-model="values.id"
                  placeholder="Layer ID"
                  class="w-fit"
                />
              </FormControl>
            </div>
          </SettingsItem>
        </FormItem>
      </FormField>
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
        <FormField name="source.id" v-slot="{ componentField }">
          <FormItem>
            <SettingsItem title="Source ID">
              <div class="flex flex-col gap-1.5">
                <FormControl>
                  <Input
                    v-bind="componentField"
                    v-model="(values.source as Source).id"
                    placeholder="Source ID"
                    class="w-fit"
                  />
                </FormControl>
              </div>
            </SettingsItem>
          </FormItem>
        </FormField>

        <FormField name="source.type" v-slot="{ componentField }">
          <FormItem>
            <SettingsItem title="Source Type">
              <FormControl>
                <Select
                  v-bind="componentField"
                  v-model="(values.source as Source).type"
                >
                  <SelectTrigger class="w-fit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="raster">Raster</SelectItem>
                    <SelectItem value="vector">Vector</SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
            </SettingsItem>
          </FormItem>
        </FormField>

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
          <FormField name="source.tiles" v-slot="{ componentField }">
            <FormItem>
              <SettingsItem title="Tiles">
                <div class="flex flex-col gap-1.5">
                  <FormControl>
                    <div class="flex flex-col gap-2">
                      <template
                        v-for="(tile, index) in tileInputs"
                        :key="index"
                      >
                        <Input
                          :value="tile"
                          @input="(e) => {
                            tileInputs[index] = (e.target as HTMLInputElement).value
                            handleNewTileInput()
                          }"
                          class="w-fit"
                          :placeholder="'Tile URL ' + (index + 1)"
                        />
                      </template>
                    </div>
                  </FormControl>
                  <FormMessage />
                </div>
              </SettingsItem>
            </FormItem>
          </FormField>

          <SettingsItem title="Tile Size">
            <Input
              v-model="(values.source as Source).tileSize"
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
              v-model="(values.source as Source).url"
              type="text"
              placeholder="URL"
              class="w-fit"
            />
          </SettingsItem>
        </template>
      </template>
    </SettingsSection>

    <FormField name="meta" v-slot="{ componentField }">
      <FormItem>
        <SettingsSection title="Custom configuration">
          <FormControl>
            <Textarea
              v-bind="componentField"
              v-model="values.meta"
              rows="10"
              placeholder="Enter JSON for meta field"
            />
          </FormControl>
        </SettingsSection>
      </FormItem>
    </FormField>
  </form>
</template>
