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
  DialogClose,
} from '@/components/ui/dialog'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

const { title, description, inputProps, label, continueText, cancelText } =
  defineProps<PromptDialogOptions>()

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
    promptInput: '',
  },
})

const isFormValid = useIsFormValid()

const onSubmit = form.handleSubmit(({ promptInput }) => {
  emit('submit', promptInput)
})

function onCancel() {
  emit('submit', null)
}
</script>

<template>
  <Dialog defaultOpen>
    <DialogContent>
      <DialogHeader v-if="title || description">
        <DialogTitle v-if="title">{{ title }}</DialogTitle>
        <DialogDescription v-if="description">
          {{ description }}
        </DialogDescription>
      </DialogHeader>

      <form id="prompt" @submit="onSubmit">
        <FormField v-slot="{ componentField }" name="promptInput">
          <FormItem>
            <FormLabel v-if="label">{{ label }}</FormLabel>
            <FormControl>
              <Input
                id="prompt-input"
                v-bind="{ ...componentField, ...inputProps }"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>
      </form>

      <DialogFooter>
        <DialogClose as-child>
          <Button @click="onCancel" variant="outline">
            {{ cancelText || $t('general.cancel') }}
          </Button>
        </DialogClose>
        <DialogClose as-child>
          <Button form="prompt" type="submit" :disabled="!isFormValid">
            {{ continueText || $t('general.continue') }}
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
