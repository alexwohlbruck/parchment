<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  icon?: Component
  verb: string
  label?: string | null
  detail?: string | null
  time?: string | null
}>()
</script>

<template>
  <div class="flex items-center gap-2.5 rounded-xl bg-muted px-3 py-2 text-[13px]">
    <component :is="icon" v-if="icon" class="size-4 shrink-0 text-muted-foreground" />
    <div class="min-w-0 flex-1">
      <div class="truncate">
        <span class="font-semibold text-foreground">{{ verb }}</span>
        <span v-if="label" class="text-muted-foreground"> · {{ label }}</span>
      </div>
      <div v-if="detail" class="truncate text-xs text-muted-foreground">{{ detail }}</div>
    </div>
    <span v-if="time" class="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{{ time }}</span>
  </div>
</template>
