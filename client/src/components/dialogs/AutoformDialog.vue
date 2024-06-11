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

const { title, description, continueText, cancelText, schema } =
  defineProps<AutoFormDialogOptions>()

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
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription v-if="description">
          {{ description }}
        </DialogDescription>

        <AutoForm :schema="schema" @submit="onSubmit" class="space-y-3">
          <DialogFooter>
            <DialogClose as-child>
              <Button @click.prevent="emit('submit', null)" variant="outline">
                {{ cancelText || 'Cancel' }}
              </Button>
            </DialogClose>
            <DialogClose as-child>
              <Button type="submit">
                {{ continueText || 'Continue' }}
              </Button>
            </DialogClose>
          </DialogFooter>
        </AutoForm>
      </DialogHeader>
    </DialogContent>
  </Dialog>
</template>
