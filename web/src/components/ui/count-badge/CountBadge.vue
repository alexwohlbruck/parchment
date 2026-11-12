<script setup lang="ts">
defineProps<{ count: number | string }>()
</script>

<template>
  <span
    class="text-[10px] font-bold text-muted-foreground bg-foreground/5 rounded-full px-1.5 py-0.5 leading-none"
  >{{ count }}</span>
</template>
