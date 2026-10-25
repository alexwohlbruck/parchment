<script setup lang="ts">
defineProps<{ name: string; refName?: string }>()
</script>

<template>
  <Transition
    mode="out-in"
    enter-active-class="transition-opacity duration-300"
    enter-from-class="opacity-0"
    leave-active-class="transition-opacity duration-200"
    leave-to-class="opacity-0"
  >
    <div
      :key="name"
      class="flex max-w-[70vw] items-center gap-1.5 truncate rounded-full bg-background/95 px-3 py-1 text-sm font-medium shadow-md"
    >
      <span v-if="refName" class="rounded bg-muted px-1 text-xs">{{ refName }}</span>
      <span class="truncate">{{ name }}</span>
    </div>
  </Transition>
</template>
