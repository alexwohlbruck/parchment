<script setup lang="ts">
defineProps<{
  diff: Array<{ key: string; from: string | null; to: string }>
}>()
</script>

<template>
  <div class="space-y-px overflow-hidden rounded font-mono text-xs">
    <template v-for="change in diff" :key="change.key">
      <div
        v-if="change.from"
        class="bg-red-500/10 px-2 py-1 text-red-700 dark:text-red-300"
      >
        − {{ change.key }}={{ change.from }}
      </div>
      <div class="bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
        + {{ change.key }}={{ change.to }}
      </div>
    </template>
  </div>
</template>
