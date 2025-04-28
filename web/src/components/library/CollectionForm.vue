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

// Define form schema with zod
const collectionSchema = toTypedSchema(
  z.object({
    name: z.string().optional(),
    description: z.string().default(''),
    icon: z.string().default('Folder'),
    iconColor: z.string().default('blue'),
    isPublic: z.boolean().default(false),
  }),
)

// Form values interface
interface CollectionFormValues {
  name: string
  description: string
  icon: string
  iconColor: string
  isPublic: boolean
}

// Initialize form with vee-validate
const { handleSubmit, values, meta, setFieldValue, resetForm } =
  useForm<CollectionFormValues>({
    validationSchema: collectionSchema,
    initialValues: {
      name: '',
      description: '',
      icon: 'Bookmark',
      iconColor: 'blue',
      isPublic: false,
    },
  })

// Load collection data if available
onMounted(() => {
  if (props.collection) {
    resetForm({
      values: {
        name: props.collection.name,
        description: props.collection.description || '',
        icon: props.collection.icon,
        iconColor: props.collection.iconColor,
        isPublic: props.collection.isPublic,
      },
    })
  }
})

// Combined icon and color style value for the picker
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

// Form submission handler
const onSubmit = handleSubmit(formValues => {
  console.log('Form submitted with values:', formValues)
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

// Watch for collection prop changes
watch(
  () => props.collection,
  newCollection => {
    if (newCollection) {
      resetForm({
        values: {
          name: newCollection.name,
          description: newCollection.description || '',
          icon: newCollection.icon,
          iconColor: newCollection.iconColor,
          isPublic: newCollection.isPublic,
        },
      })
    }
  },
  { deep: true },
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
        <FormLabel
          >{{ t('general.name') }}
          <span
            v-if="collection?.isDefault"
            class="text-muted-foreground text-xs"
            >({{ t('general.optional') }})</span
          ></FormLabel
        >
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
