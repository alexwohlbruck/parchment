<script setup lang="ts">
import { ChevronRightIcon } from 'lucide-vue-next'
defineProps<{ expanded: boolean }>()
</script>

<template>
  <ChevronRightIcon
    class="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150"
    :class="expanded && 'rotate-90'"
  />
</template>
