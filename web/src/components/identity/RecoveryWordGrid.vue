<script setup lang="ts">
defineProps<{ words: string[] }>()
</script>

<template>
  <ol class="grid grid-cols-3 gap-x-2 gap-y-1.5 text-left font-mono text-[13px]">
    <li v-for="(word, i) in words" :key="i" class="flex items-baseline gap-1.5">
      <span class="w-4 shrink-0 select-none text-right text-[11px] tabular-nums text-muted-foreground">{{ i + 1 }}</span>
      <span>{{ word }}</span>
    </li>
  </ol>
</template>
