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
const emit = defineEmits(['submit'])
const isValid = ref(true)
const componentRef = ref()
const isLoading = ref(false)
const isOpen = ref(true)

async function submit() {
  isLoading.value = true
  try {
    const result = await componentRef.value?.submit?.()
    emit('submit', result)
    return result
  } finally {
    isLoading.value = false
    isOpen.value = false
  }
}
</script>

<template>
  <Dialog :open="isOpen" @update:open="isOpen = $event">
    <DialogContent
      class="flex flex-col p-4 sm:p-6 h-full sm:h-auto w-full sm:max-h-[90vh] md:max-w-[70%] lg:max-w-[50vw] md:max-h-[90dvh] sm:max-h-[90dvh]"
    >
      <DialogHeader v-if="props.title || props.description">
        <DialogTitle v-if="props.title">{{ props.title }}</DialogTitle>
        <DialogDescription v-if="props.description">
          {{ props.description }}
        </DialogDescription>
      </DialogHeader>

      <div class="overflow-y-auto h-full">
        <component
          ref="componentRef"
          :is="props.component"
          v-bind="props?.props || {}"
          :class="cn(props?.props?.class, 'overflow-y-auto')"
          @update:valid="valid => (isValid = valid)"
        />
      </div>

      <DialogFooter class="flex flex-row gap-2 sm:gap-0">
        <Button
          class="flex-1 sm:flex-none"
          variant="outline"
          @click="isOpen = false"
        >
          {{ props.cancelText || $t('general.cancel') }}
        </Button>
        <Button
          class="!mt-0 flex-1 sm:flex-none"
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
