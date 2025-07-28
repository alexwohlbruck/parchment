<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { useI18n } from 'vue-i18n'
import { useMapStore } from '@/stores/map.store'
import { type LayerGroup } from '@/types/map.types'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { IconPicker } from '@/components/ui/icon-picker'
import { SettingsSection, SettingsItem } from '@/components/settings'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { type ThemeColor } from '@/lib/utils'
import { FolderIcon } from 'lucide-vue-next'

const mapStore = useMapStore()
const { t } = useI18n()

const props = defineProps<{
  groupId?: string
}>()

const emit = defineEmits<{
  'update:valid': [valid: boolean]
  submit: [values: any]
}>()

const editing = computed(() => !!props.groupId)
const group = computed(() =>
  props.groupId ? mapStore.layerGroups.find(g => g.id === props.groupId) : null,
)

const layerGroupSchema = computed(() => {
  return toTypedSchema(
    z.object({
      name: z.string().min(1, 'Name is required'),
      enabled: z.boolean().default(true),
      visible: z.boolean().default(true),
      icon: z.string().default('FolderIcon'),
      iconColor: z.string().default('blue'),
    }),
  )
})

interface LayerGroupFormValues {
  name: string
  enabled: boolean
  visible: boolean
  icon: string
  iconColor: string
}

const { handleSubmit, values, meta, setFieldValue, resetForm } =
  useForm<LayerGroupFormValues>({
    validationSchema: layerGroupSchema,
    initialValues: {
      name: '',
      enabled: true,
      visible: true,
      icon: 'FolderIcon',
      iconColor: 'blue',
    },
  })

// Initialize form with existing group data if editing
watch(
  () => group.value,
  currentGroup => {
    if (currentGroup) {
      resetForm({
        values: {
          name: currentGroup.name,
          enabled: currentGroup.enabled,
          visible: currentGroup.visible,
          icon: currentGroup.icon?.name || 'FolderIcon',
          iconColor: 'blue', // Default since we don't store color in LayerGroup
        },
      })
    }
  },
  { immediate: true },
)

const onSubmit = handleSubmit(values => {
  if (editing.value && props.groupId) {
    // Update existing group
    mapStore.updateLayerGroup(props.groupId, {
      name: values.name,
      enabled: values.enabled,
      visible: values.visible,
      icon: values.icon === 'FolderIcon' ? undefined : (values.icon as any),
    })
  } else {
    // Create new group
    mapStore.addLayerGroup({
      name: values.name,
      enabled: values.enabled,
      visible: values.visible,
      icon: values.icon === 'FolderIcon' ? undefined : (values.icon as any),
      order: mapStore.layerGroups.length,
      layerIds: [],
    })
  }
})

// Watch form validity
watch(
  () => meta.value.valid,
  valid => {
    emit('update:valid', valid)
  },
  { immediate: true },
)

defineExpose({
  submit: onSubmit,
})
</script>

<template>
  <form @submit="onSubmit" class="space-y-4">
    <SettingsSection
      :title="editing ? t('layers.groups.edit') : t('layers.groups.create')"
      :frame="false"
      :shadow="false"
    >
      <FormField name="enabled" v-slot="{ value, handleChange }">
        <FormItem>
          <SettingsItem :title="t('layers.meta.fields.enabled')">
            <FormControl>
              <Switch :model-value="value" @update:model-value="handleChange" />
            </FormControl>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="visible" v-slot="{ value, handleChange }">
        <FormItem>
          <SettingsItem :title="t('layers.groups.fields.visible')">
            <FormControl>
              <Switch :model-value="value" @update:model-value="handleChange" />
            </FormControl>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="name" v-slot="{ componentField }">
        <FormItem>
          <SettingsItem :title="t('layers.groups.fields.name')">
            <div class="flex flex-col gap-1.5">
              <FormControl>
                <Input
                  v-bind="componentField"
                  :placeholder="t('layers.groups.fields.namePlaceholder')"
                  class="w-fit"
                />
              </FormControl>
              <FormMessage />
            </div>
          </SettingsItem>
        </FormItem>
      </FormField>

      <FormField name="icon" v-slot="{ value, handleChange }">
        <FormItem>
          <SettingsItem :title="t('layers.groups.fields.icon')">
            <FormControl>
              <IconPicker
                :model-value="{ icon: value, color: values.iconColor as ThemeColor }"
                @update:model-value="
                  newValue => {
                    handleChange(newValue.icon)
                    setFieldValue('iconColor', newValue.color)
                  }
                "
                :placeholder="t('layers.groups.fields.iconPlaceholder')"
              />
            </FormControl>
          </SettingsItem>
        </FormItem>
      </FormField>
    </SettingsSection>
  </form>
</template>
