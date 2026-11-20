<script lang="ts" setup>
import { Toaster as Sonner, type ToasterProps } from 'vue-sonner'

const props = defineProps<ToasterProps>()

const TOAST_BUTTON =
  '!bg-transparent !text-current !font-medium hover:!bg-current/10 !rounded-md !px-2'
</script>

<template>
  <Sonner
    class="toaster group pointer-events-auto"
    @pointerdown.stop
    @touchmove.stop
    v-bind="props"
    :toast-options="{
      classes: {
        toast:
          'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:shadow-lg',
        description: 'group-[.toast]:text-muted-foreground',
        // Both buttons are ghosts in the toast's own colour (richColors paints
        // it through `currentColor`); `!` beats sonner's inline defaults.
        // Sonner pushes every button right with an auto margin, which splits
        // the free space between two; the action follows the cancel, so it sits beside it.
        actionButton: `${TOAST_BUTTON} [[data-cancel]+&]:!ml-1`,
        cancelButton: TOAST_BUTTON,
      },
    }"
  />
</template>
