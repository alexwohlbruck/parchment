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
import { ConfirmDialogOptions } from '@/types/app.types'

const { title, description, destructive, continueText, cancelText } =
  defineProps<ConfirmDialogOptions>()

const emit = defineEmits<{
  (e: 'submit', payload: boolean): void
}>()
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
          <Button @click="emit('submit', false)" variant="outline">
            {{ cancelText || 'Cancel' }}
          </Button>
        </DialogClose>
        <DialogClose as-child>
          <Button
            @click="emit('submit', true)"
            :variant="destructive ? 'destructive' : 'default'"
          >
            {{ continueText || 'Continue' }}
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
