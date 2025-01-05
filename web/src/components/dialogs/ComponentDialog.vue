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
import { ComponentDialogOptions } from '@/types/app.types'
import { cn } from '@/lib/utils'

const {
  title,
  description,
  continueText,
  cancelText,
  destructive = false,
  props,
  component,
} = defineProps<ComponentDialogOptions>()

const emit = defineEmits<{
  (e: 'submit', payload: boolean): void
}>()
</script>

<template>
  <Dialog defaultOpen>
    <DialogContent class="max-h-[90dvh]">
      <DialogHeader v-if="title || description">
        <DialogTitle v-if="title">{{ title }}</DialogTitle>
        <DialogDescription v-if="description">
          {{ description }}
        </DialogDescription>
      </DialogHeader>

      <div class="overflow-y-auto max-h-[70dvh]">
        <component
          :is="component"
          v-bind="props || {}"
          :class="cn(props?.class, 'overflow-y-auto')"
        />
      </div>

      <DialogFooter>
        <DialogClose as-child>
          <Button @click="emit('submit', false)" variant="outline">
            {{ cancelText || $t('general.cancel') }}
          </Button>
        </DialogClose>
        <DialogClose as-child>
          <Button
            @click="emit('submit', true)"
            :variant="destructive ? 'destructive' : 'default'"
          >
            {{ continueText || $t('general.continue') }}
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
