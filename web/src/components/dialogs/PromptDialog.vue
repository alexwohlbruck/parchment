<script setup lang="ts">
import { useForm, useIsFormValid } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { PromptDialogOptions } from '@/types/app.types'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { ref, watch } from 'vue'

interface Props extends PromptDialogOptions {
  loading?: boolean
}
const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'submit', payload: string | null): void
}>()

const formSchema = toTypedSchema(
  z.object({
    promptInput: z.string().min(1),
  }),
)

const form = useForm({
  validationSchema: formSchema,
  initialValues: {
    promptInput: props.defaultValue || '',
  },
})

const isFormValid = useIsFormValid()

const onSubmit = form.handleSubmit(({ promptInput }) => {
  emit('submit', promptInput)
})

const isOpen = ref(true)
watch(isOpen, value => {
  if (!value) {
    emit('submit', null)
  }
})
</script>

<template>
  <Dialog :open="isOpen" @update:open="isOpen = $event">
    <DialogContent>
      <DialogHeader v-if="props.title || props.description">
        <DialogTitle v-if="props.title">{{ props.title }}</DialogTitle>
        <DialogDescription v-if="props.description">
          {{ props.description }}
        </DialogDescription>
      </DialogHeader>

      <form id="prompt" @submit="onSubmit">
        <FormField v-slot="{ componentField }" name="promptInput">
          <FormItem>
            <FormLabel v-if="props.label">{{ props.label }}</FormLabel>
            <FormControl>
              <Input
                id="prompt-input"
                v-bind="{ ...componentField, ...props.inputProps }"
                :disabled="props.loading"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>
      </form>

      <DialogFooter class="flex flex-col sm:flex-row gap-2">
        <Button
          @click="isOpen = false"
          variant="outline"
          :disabled="props.loading"
        >
          {{ props.cancelText || $t('general.cancel') }}
        </Button>
        <Button
          form="prompt"
          type="submit"
          :disabled="!isFormValid || props.loading"
          :loading="props.loading"
        >
          {{ props.continueText || $t('general.continue') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
