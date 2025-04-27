<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { IconPicker } from '@/components/ui/icon-picker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SavedPlace } from '@/types/library.types'
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
  place: SavedPlace
}>()

// Place types - using same options as collections for now
const placeTypes = [
  { value: 'home', label: t('library.types.home') },
  { value: 'work', label: t('library.types.work') },
  { value: 'school', label: t('library.types.school') },
]

// Define form schema with zod
const placeSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Name is required'),
    type: z.string().optional(),
    icon: z.string().default('MapPin'),
    iconColor: z.string().default('blue'),
  }),
)

// Form values interface
interface SavedPlaceFormValues {
  name: string
  type?: string
  icon: string
  iconColor: string
}

// Initialize form with vee-validate
const { handleSubmit, values, meta, setFieldValue, resetForm } =
  useForm<SavedPlaceFormValues>({
    validationSchema: placeSchema,
    initialValues: {
      name: '',
      type: undefined,
      icon: 'MapPin',
      iconColor: 'blue',
    },
  })

// Load place data if available
onMounted(() => {
  if (props.place) {
    resetForm({
      values: {
        name: props.place.name,
        type: props.place.presetType || undefined,
        icon: props.place.icon,
        iconColor: props.place.iconColor as ThemeColor,
      },
    })
  }
})

// Combined icon and color style value for the picker
const placeStyle = computed({
  get: () => ({
    icon: values.icon || 'MapPin',
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

// Watch for place prop changes
watch(
  () => props.place,
  newPlace => {
    if (newPlace) {
      resetForm({
        values: {
          name: newPlace.name,
          type: newPlace.presetType || undefined,
          icon: newPlace.icon,
          iconColor: newPlace.iconColor as ThemeColor,
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
        <FormLabel>{{ t('general.name') }} *</FormLabel>
        <FormControl>
          <Input
            v-bind="field"
            :placeholder="t('library.form.placeholders.placeName')"
          />
        </FormControl>
        <FormMessage>{{ errorMessage }}</FormMessage>
      </FormItem>
    </FormField>

    <!-- Place type field -->
    <FormField name="type" v-slot="{ field }">
      <FormItem>
        <FormLabel>{{ t('general.type') }}</FormLabel>
        <FormControl>
          <Select
            :model-value="field.value"
            @update:model-value="field.onChange"
            :can-clear="true"
          >
            <SelectTrigger>
              <SelectValue
                :placeholder="t('library.form.placeholders.placeType')"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="type in placeTypes"
                :key="type.value"
                :value="type.value"
              >
                {{ type.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </FormControl>
      </FormItem>
    </FormField>

    <!-- Icon picker -->
    <FormField name="icon" v-slot="{}">
      <FormItem>
        <FormLabel>{{ t('general.icon') }}</FormLabel>
        <FormControl>
          <IconPicker v-model="placeStyle" />
        </FormControl>
      </FormItem>
    </FormField>

    <!-- We've removed description and notes fields since they don't exist on the SavedPlace type -->
  </form>
</template>
