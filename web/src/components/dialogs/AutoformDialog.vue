<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AutoForm } from '@/components/ui/auto-form'
import { AutoFormDialogOptions } from '@/types/app.types'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const {
  title,
  description,
  continueText,
  cancelText,
  schema,
  initialValues,
  fieldConfig,
} = defineProps<AutoFormDialogOptions>()

const emit = defineEmits<{
  (e: 'submit', payload: Record<string, any> | null): void
}>()

function onSubmit(values: Record<string, any>) {
  emit('submit', values)
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

        <AutoForm
          :schema="schema"
          :initial-values="initialValues"
          :field-config="fieldConfig"
          @submit="onSubmit"
          class="space-y-3"
        >
          <DialogFooter>
            <DialogClose as-child>
              <Button @click.prevent="emit('submit', null)" variant="outline">
                {{ cancelText || t('general.cancel') }}
              </Button>
            </DialogClose>
            <DialogClose as-child>
              <Button type="submit">
                {{ continueText || t('general.continue') }}
              </Button>
            </DialogClose>
          </DialogFooter>
        </AutoForm>
      </DialogHeader>
    </DialogContent>
  </Dialog>
</template>
