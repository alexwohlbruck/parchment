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
import type { Bookmark } from '@/types/library.types'
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
  bookmark: Bookmark
}>()

const bookmarkTypes = [
  { value: 'home', label: t('library.types.home') },
  { value: 'work', label: t('library.types.work') },
  { value: 'school', label: t('library.types.school') },
]

const bookmarkSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Name is required'),
    type: z.string().optional(),
    icon: z.string().default('MapPin'),
    iconColor: z.string().default('blue'),
  }),
)

interface BookmarkFormValues {
  name: string
  type?: string
  icon: string
  iconColor: string
}

const { handleSubmit, values, meta, setFieldValue, resetForm } =
  useForm<BookmarkFormValues>({
    validationSchema: bookmarkSchema,
    initialValues: {
      name: '',
      type: undefined,
      icon: 'MapPin',
      iconColor: 'blue',
    },
  })

onMounted(() => {
  if (props.bookmark) {
    resetForm({
      values: {
        name: props.bookmark.name,
        type: props.bookmark.presetType || undefined,
        icon: props.bookmark.icon,
        iconColor: props.bookmark.iconColor as ThemeColor,
      },
    })
  }
})

const bookmarkStyle = computed({
  get: () => ({
    icon: values.icon || 'MapPin',
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
  () => props.bookmark,
  newBookmark => {
    if (newBookmark) {
      resetForm({
        values: {
          name: newBookmark.name,
          type: newBookmark.presetType || undefined,
          icon: newBookmark.icon,
          iconColor: newBookmark.iconColor as ThemeColor,
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
        <FormLabel>{{ t('general.name') }} *</FormLabel>
        <FormControl>
          <Input
            v-bind="field"
            :placeholder="t('library.form.placeholders.bookmarkName')"
          />
        </FormControl>
        <FormMessage>{{ errorMessage }}</FormMessage>
      </FormItem>
    </FormField>

    <!-- Bookmark type field -->
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
                :placeholder="t('library.form.placeholders.bookmarkType')"
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="type in bookmarkTypes"
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
          <IconPicker v-model="bookmarkStyle" />
        </FormControl>
      </FormItem>
    </FormField>

    <!-- We've removed description and notes fields since they don't exist on the Bookmark type -->
  </form>
</template>
