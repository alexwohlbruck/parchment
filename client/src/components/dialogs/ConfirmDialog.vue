<script setup lang="ts">
import { defineProps, defineEmits } from 'vue'
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
import { ConfirmDialogOptions } from '@/types/app.types'

const { title, description, destructive, continueText, cancelText } =
  defineProps<ConfirmDialogOptions>()

const emit = defineEmits<{
  (e: 'submit', payload: boolean): void
}>()

function confirm() {
  emit('submit', true)
}

function cancel() {
  emit('submit', false)
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
      </DialogHeader>

      <DialogFooter>
        <DialogClose as-child>
          <Button @click="cancel()" variant="outline">
            {{ cancelText || 'Cancel' }}
          </Button>
        </DialogClose>
        <DialogClose as-child>
          <Button
            @click="confirm()"
            :variant="destructive ? 'destructive' : 'default'"
          >
            {{ continueText || 'Continue' }}
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
