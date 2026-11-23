<script setup lang="ts">
import { CloudOffIcon } from 'lucide-vue-next'

defineProps<{ text: string }>()
</script>

<template>
  <p class="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
    <CloudOffIcon class="mt-px size-3.5 shrink-0" />
    {{ text }}
  </p>
</template>
