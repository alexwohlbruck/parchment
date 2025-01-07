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
import { ref } from 'vue'

const props = defineProps<ComponentDialogOptions>()
const isValid = ref(true)
const componentRef = ref()
const isLoading = ref(false)
const isOpen = ref(true)

async function submit() {
  isLoading.value = true
  try {
    await componentRef.value?.submit?.()
  } finally {
    isLoading.value = false
    isOpen.value = false
  }
}
</script>

<template>
  <Dialog :open="isOpen" @update:open="isOpen = $event">
    <!-- TODO: Mobile layout -->
    <DialogContent class="max-h-[90dvh] max-w-[50vw]">
      <DialogHeader v-if="props.title || props.description">
        <DialogTitle v-if="props.title">{{ props.title }}</DialogTitle>
        <DialogDescription v-if="props.description">
          {{ props.description }}
        </DialogDescription>
      </DialogHeader>

      <div class="overflow-y-auto max-h-[70dvh]">
        <component
          ref="componentRef"
          :is="props.component"
          v-bind="props?.props || {}"
          :class="cn(props?.props?.class, 'overflow-y-auto')"
          @update:valid="valid => (isValid = valid)"
        />
      </div>

      <DialogFooter>
        <Button variant="outline" @click="isOpen = false">
          {{ props.cancelText || $t('general.cancel') }}
        </Button>
        <Button
          @click="submit"
          :variant="props.destructive ? 'destructive' : 'default'"
          :disabled="!isValid"
          :loading="isLoading"
        >
          {{ props.continueText || $t('general.continue') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
