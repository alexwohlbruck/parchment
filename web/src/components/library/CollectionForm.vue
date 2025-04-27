<script setup lang="ts">
import { computed, watch } from 'vue'
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

// Define form schema with zod
const collectionSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().default(''),
    icon: z.string().default('folder'),
    iconColor: z.string().default('blue'),
    isPublic: z.boolean().default(false),
  }),
)

// Initialize form with vee-validate
const { handleSubmit, values, meta, setFieldValue } = useForm({
  validationSchema: collectionSchema,
  initialValues: {
    name: props.collection?.name || '',
    description: props.collection?.description || '',
    icon: props.collection?.icon || 'folder',
    iconColor: props.collection?.iconColor || 'blue',
    isPublic: props.collection?.isPublic || false,
  },
})

// Combined icon and color style value for the picker
const collectionStyle = computed({
  get: () => ({
    icon: values.icon || 'folder',
    color: values.iconColor as ThemeColor,
  }),
  set: newValue => {
    setFieldValue('icon', newValue.icon)
    setFieldValue('iconColor', newValue.color)
  },
})

// Form submission handler
const onSubmit = handleSubmit(formValues => {
  // Just return the raw form values
  return formValues
})

// Watch form validity and emit to parent
watch(
  () => meta.value.valid,
  valid => {
    emit('update:valid', valid)
  },
  { immediate: true },
)

// Expose submit method to parent component
defineExpose({
  submit: onSubmit,
})
</script>

<template>
  <form @submit.prevent="onSubmit" class="space-y-4">
    <!-- Name field -->
    <FormField name="name" v-slot="{ field, errorMessage }">
      <FormItem>
        <FormLabel>{{ t('general.name') }} *</FormLabel>
        <FormControl>
          <Input
            v-bind="field"
            :placeholder="t('library.form.placeholders.collectionName')"
          />
        </FormControl>
        <FormMessage>{{ errorMessage }}</FormMessage>
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
