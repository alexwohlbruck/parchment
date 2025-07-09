<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AutoForm } from '@/components/ui/auto-form'
import { AutoFormDialogOptions } from '@/types/app.types'
import { useI18n } from 'vue-i18n'
import { ref, watch } from 'vue'

const { t } = useI18n()

interface Props extends AutoFormDialogOptions {
  loading?: boolean
}
const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'submit', payload: Record<string, any> | null): void
}>()

const isOpen = ref(true)

watch(isOpen, value => {
  if (!value) {
    emit('submit', null)
  }
})

function onSubmit(values: Record<string, any>) {
  emit('submit', values)
}
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

      <AutoForm
        id="autoform"
        :schema="props.schema"
        :initial-values="props.initialValues"
        :field-config="props.fieldConfig"
        @submit="onSubmit"
        class="space-y-3"
      />

      <DialogFooter>
        <Button
          @click.prevent="isOpen = false"
          variant="outline"
          :disabled="props.loading"
        >
          {{ props.cancelText || t('general.cancel') }}
        </Button>
        <Button
          form="autoform"
          type="submit"
          :loading="props.loading"
          :disabled="props.loading"
        >
          {{ props.continueText || t('general.continue') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
