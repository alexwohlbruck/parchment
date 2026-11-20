<script lang="ts" setup>
import { Toaster as Sonner, type ToasterProps } from 'vue-sonner'

const props = defineProps<ToasterProps>()

const TOAST_BUTTON = '!font-medium !rounded-md !px-2'

const GHOST_BUTTON = `${TOAST_BUTTON} !bg-transparent !text-current hover:!bg-current/10`

/** Filled in the toast's own text colour, labelled in its background colour. */
const SOLID_BUTTON = [
  TOAST_BUTTON,
  '!bg-foreground !text-background hover:opacity-90',
  'group-data-[type=success]:!bg-[var(--success-text)] group-data-[type=success]:!text-[var(--success-bg)]',
  'group-data-[type=info]:!bg-[var(--info-text)] group-data-[type=info]:!text-[var(--info-bg)]',
  'group-data-[type=warning]:!bg-[var(--warning-text)] group-data-[type=warning]:!text-[var(--warning-bg)]',
  'group-data-[type=error]:!bg-[var(--error-text)] group-data-[type=error]:!text-[var(--error-bg)]',
].join(' ')
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
        // `!` beats sonner's inline button defaults. Sonner pushes every
        // button right with an auto margin, which splits the free space
        // between two; the action follows the cancel, so it sits beside it.
        actionButton: `${SOLID_BUTTON} [[data-cancel]+&]:!ml-1.5`,
        cancelButton: GHOST_BUTTON,
      },
    }"
  />
</template>
