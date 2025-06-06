<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialogOptions } from '@/types/app.types'
import { ref, watch } from 'vue'

interface Props extends ConfirmDialogOptions {
  loading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'submit', payload: boolean): void
}>()

const isOpen = ref(true)

watch(isOpen, value => {
  if (!value) {
    emit('submit', false)
  }
})
</script>

<template>
  <AlertDialog :open="isOpen" @update:open="isOpen = $event">
    <AlertDialogContent>
      <AlertDialogHeader v-if="props.title || props.description">
        <AlertDialogTitle v-if="props.title">{{
          props.title
        }}</AlertDialogTitle>
        <AlertDialogDescription v-if="props.description">
          {{ props.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <AlertDialogFooter>
        <Button
          @click="isOpen = false"
          variant="outline"
          :disabled="props.loading"
        >
          {{ props.cancelText || $t('general.cancel') }}
        </Button>
        <Button
          @click="emit('submit', true)"
          :variant="props.destructive ? 'destructive' : 'default'"
          :loading="props.loading"
          :disabled="props.loading"
        >
          {{ props.continueText || $t('general.continue') }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
