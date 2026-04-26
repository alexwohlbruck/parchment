<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { IconPicker } from '@/components/ui/icon-picker'
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

const { t } = useI18n()
const emit = defineEmits(['update:valid'])

const props = defineProps<{
  collection?: Collection
}>()

const collectionSchema = toTypedSchema(
  z.object({
    name: z.string().min(1),
    description: z.string().default(''),
    icon: z.string().default('Folder'),
    iconPack: z.enum(['lucide', 'maki']).default('lucide'),
    iconColor: z.string().default('blue'),
    isPublic: z.boolean().default(false),
  }),
)

interface CollectionFormValues {
  name: string
  description: string
  icon: string
  iconPack: 'lucide' | 'maki'
  iconColor: string
  isPublic: boolean
}

const { handleSubmit, values, meta, setFieldValue, resetForm } =
  useForm<CollectionFormValues>({
    validationSchema: collectionSchema,
    initialValues: {
      name: '',
      description: '',
      icon: 'Bookmark',
      iconPack: 'lucide',
      iconColor: 'blue',
      isPublic: false,
    },
  })

onMounted(() => {
  if (props.collection) {
    resetForm({
      values: {
        name: props.collection.name ?? '',
        description: props.collection.description || '',
        icon: props.collection.icon ?? 'Bookmark',
        iconPack: props.collection.iconPack ?? 'lucide',
        iconColor: props.collection.iconColor ?? 'blue',
        isPublic: props.collection.isPublic,
      },
    })
  }
})

const collectionStyle = computed({
  get: () => ({
    icon: values.icon || 'Folder',
    iconPack: values.iconPack ?? 'lucide',
    color: values.iconColor as ThemeColor,
  }),
  set: newValue => {
    setFieldValue('icon', newValue.icon)
    if (newValue.iconPack) setFieldValue('iconPack', newValue.iconPack)
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
          iconPack: newCollection.iconPack ?? 'lucide',
          iconColor: newCollection.iconColor ?? 'blue',
          isPublic: newCollection.isPublic,
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
        <FormLabel>{{ t('general.name') }}</FormLabel>
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

  </form>
</template>
