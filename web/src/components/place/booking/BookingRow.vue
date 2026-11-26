<script setup lang="ts">
import { ExternalLinkIcon } from 'lucide-vue-next'

defineProps<{ href: string }>()
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    class="-mx-2 flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent"
  >
    <slot name="logo" />
    <div class="flex min-w-0 flex-1 flex-col">
      <span class="text-sm leading-snug break-words"><slot /></span>
      <span v-if="$slots.detail" class="text-xs text-muted-foreground"><slot name="detail" /></span>
    </div>
    <slot name="end" />
    <ExternalLinkIcon class="size-3.5 shrink-0 text-muted-foreground" />
  </a>
</template>
