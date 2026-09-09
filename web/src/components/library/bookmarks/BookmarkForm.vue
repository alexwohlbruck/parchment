<script setup lang="ts">
import { watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Bookmark } from '@/types/library.types'
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
  { value: 'custom', label: t('library.types.custom') },
]

// Icon and colour are absent by design. A bookmark shows the POI's own icon
// in collection lists, its parent collection's on the map, and — for a
// frequent — the look fixed by its type. None of that is a user choice, so
// there is nothing here to pick.
const bookmarkSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Name is required'),
    type: z.string().optional(),
  }),
)

interface BookmarkFormValues {
  name: string
  type?: string
}

const { handleSubmit, meta, resetForm } = useForm<BookmarkFormValues>({
  validationSchema: bookmarkSchema,
  initialValues: {
    name: '',
    type: undefined,
  },
})

onMounted(() => {
  if (props.bookmark) {
    resetForm({
      values: {
        name: props.bookmark.name,
        type: props.bookmark.frequentType || undefined,
      },
    })
  }
})

const onSubmit = handleSubmit(formValues => {
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
          type: newBookmark.frequentType || undefined,
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
        <FormLabel>{{ t('library.form.frequent') }}</FormLabel>
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

    <!-- We've removed description and notes fields since they don't exist on the Bookmark type -->
  </form>
</template>
