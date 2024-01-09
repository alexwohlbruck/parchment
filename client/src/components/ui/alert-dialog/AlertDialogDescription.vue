<script setup lang="ts">
import {
  AlertDialogDescription,
  type AlertDialogDescriptionProps,
} from 'radix-vue'
import { cn } from '@/lib/utils'

const props = defineProps<AlertDialogDescriptionProps & { class?: string }>()
</script>

<template>
  <AlertDialogDescription
    :class="cn('text-zinc-500 text-sm dark:text-zinc-400', props.class)"
    :as-child="props.asChild"
  >
    <slot />
  </AlertDialogDescription>
</template>
