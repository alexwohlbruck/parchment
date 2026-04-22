<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { IconPicker } from '@/components/ui/icon-picker'
import { Checkbox } from '@/components/ui/checkbox'
import type { Collection } from '@/types/library.types'
import type { ThemeColor } from '@/lib/utils'
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
import { useCollectionsService } from '@/services/library/collections.service'

const { t } = useI18n()
const emit = defineEmits(['update:valid'])

const props = defineProps<{
  collection?: Collection
}>()

const collectionsService = useCollectionsService()

const collectionSchema = toTypedSchema(
  z.object({
    name: z.string().min(1),
    description: z.string().default(''),
    icon: z.string().default('Folder'),
    iconColor: z.string().default('blue'),
    isPublic: z.boolean().default(false),
    isDefault: z.boolean().default(false),
  }),
)

interface CollectionFormValues {
  name: string
  description: string
  icon: string
  iconColor: string
  isPublic: boolean
  isDefault: boolean
}

const { handleSubmit, values, meta, setFieldValue, resetForm } =
  useForm<CollectionFormValues>({
    validationSchema: collectionSchema,
    initialValues: {
      name: '',
      description: '',
      icon: 'Bookmark',
      iconColor: 'blue',
      isPublic: false,
      isDefault: false,
    },
  })

onMounted(() => {
  if (props.collection) {
    resetForm({
      values: {
        name: props.collection.name ?? '',
        description: props.collection.description || '',
        icon: props.collection.icon ?? 'Bookmark',
        iconColor: props.collection.iconColor ?? 'blue',
        isPublic: props.collection.isPublic,
        isDefault: props.collection.isDefault || false,
      },
    })

    if (props.collection.isDefault && !props.collection.name) {
      setFieldValue(
        'name',
        collectionsService.getCollectionDisplayName(props.collection),
      )
    }
  }
})

const collectionStyle = computed({
  get: () => ({
    icon: values.icon || 'Folder',
    color: values.iconColor as ThemeColor,
  }),
  set: newValue => {
    setFieldValue('icon', newValue.icon)
    setFieldValue('iconColor', newValue.color)
  },
})

const onSubmit = handleSubmit(formValues => {
  console.log('Form submitted with values:', formValues)
  return formValues
})

watch(
  () => meta.value.valid,
  valid => {
    emit('update:valid', valid)
  },
  { immediate: true },
)

watch(
  () => props.collection,
  newCollection => {
    if (newCollection) {
      resetForm({
        values: {
          name: newCollection.name ?? '',
          description: newCollection.description || '',
          icon: newCollection.icon ?? 'Bookmark',
          iconColor: newCollection.iconColor ?? 'blue',
          isPublic: newCollection.isPublic,
          isDefault: newCollection.isDefault || false,
        },
      })
    }
  },
  { deep: true },
)

defineExpose({
  submit: onSubmit,
})
</script>

<template>
  <form @submit.prevent="onSubmit" class="space-y-4">
    <!-- Name field -->
    <FormField name="name" v-slot="{ field, errorMessage }">
      <FormItem>
        <FormLabel
          >{{ t('general.name') }}
          <!-- <span v-if="values.isDefault" class="text-muted-foreground text-xs"
            >({{ t('general.optional') }})</span
          > -->
        </FormLabel>
        <FormControl>
          <Input
            v-bind="field"
            :placeholder="t('library.form.placeholders.collectionName')"
          />
        </FormControl>
        <FormMessage v-if="errorMessage">
          {{ t(errorMessage) }}
        </FormMessage>
      </FormItem>
    </FormField>

    <!-- Icon picker -->
    <FormField name="icon" v-slot="{}">
      <FormItem>
        <FormLabel>{{ t('general.icon') }}</FormLabel>
        <FormControl>
          <IconPicker v-model="collectionStyle" />
        </FormControl>
      </FormItem>
    </FormField>

    <!-- Description field -->
    <FormField name="description" v-slot="{ field }">
      <FormItem>
        <FormLabel>{{ t('general.description') }}</FormLabel>
        <FormControl>
          <Textarea
            v-bind="field"
            rows="3"
            :placeholder="t('library.form.placeholders.collectionDescription')"
          />
        </FormControl>
      </FormItem>
    </FormField>

    <!-- isDefault field (disabled checkbox) -->
    <FormField name="isDefault" v-slot="{ field }">
      <FormItem class="flex flex-row items-start space-x-3 space-y-0">
        <FormControl>
          <Checkbox :model-value="field.value" disabled />
        </FormControl>
        <div class="space-y-1 leading-none">
          <FormLabel>{{ t('library.form.isDefault') }}</FormLabel>
        </div>
      </FormItem>
    </FormField>
  </form>
</template>
