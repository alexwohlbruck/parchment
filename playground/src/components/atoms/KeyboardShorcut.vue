<script setup lang="ts">
defineProps<{
  shortcut: string
}>()
</script>

<template>
  <span class="ml-auto border-1 surface-border border-round surface-100 text-xs p-1">
    {{ shortcut }}
  </span>
</template>
