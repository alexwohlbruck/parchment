<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  title: string
  description: string
  icon?: Component
}>()
</script>

<template>
  <div class="space-y-6">
    <div v-if="icon" class="relative flex h-28 items-center justify-center overflow-hidden rounded-2xl border bg-primary/5" aria-hidden="true">
      <div class="absolute size-44 rounded-full border border-primary/10" />
      <div class="absolute size-64 rounded-full border border-primary/5" />
      <div class="relative flex size-16 -rotate-6 items-center justify-center rounded-2xl border bg-background shadow-sm">
        <component :is="icon" class="size-8 rotate-6 text-primary" :stroke-width="1.5" />
      </div>
    </div>
    <div class="space-y-2 text-center">
      <h2 class="text-balance text-2xl font-semibold">{{ title }}</h2>
      <p class="mx-auto max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">{{ description }}</p>
    </div>
  </div>
</template>
