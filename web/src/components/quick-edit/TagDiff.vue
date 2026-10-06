<script setup lang="ts">
import type { TagChange } from '@/types/quick-edit.types'

defineProps<{
  diff: TagChange[]
}>()
</script>

<template>
  <div class="space-y-px overflow-hidden rounded font-mono text-xs">
    <template v-for="change in diff" :key="change.key">
      <div
        v-if="change.from !== null"
        class="bg-red-500/10 px-2 py-1 text-red-700 dark:text-red-300"
      >
        − {{ change.key }}={{ change.from }}
      </div>
      <div
        v-if="change.to !== null"
        class="bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300"
      >
        + {{ change.key }}={{ change.to }}
      </div>
    </template>
  </div>
</template>
