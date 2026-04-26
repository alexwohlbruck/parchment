<script lang="ts" setup>
import { Toaster as Sonner, type ToasterProps } from 'vue-sonner'

const props = defineProps<ToasterProps>()
</script>

<template>
  <Sonner
    class="toaster group"
    v-bind="props"
    :toast-options="{
      classes: {
        toast:
          'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
        description: 'group-[.toast]:text-muted-foreground',
        // Outlined ghost so the button blends with whatever color the
        // toast is rendered in (richColors paints success/error/info
        // backgrounds via `currentColor`-based vars). `!` flags beat
        // sonner's inline default styles, otherwise the action button
        // ends up solid black on a green success toast.
        actionButton:
          '!bg-transparent !text-current border border-current/30 hover:!bg-current/10',
        cancelButton:
          'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
      },
    }"
  />
</template>
