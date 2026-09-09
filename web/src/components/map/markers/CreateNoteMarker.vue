<script setup lang="ts">
import { MessageSquareIcon } from 'lucide-vue-next'
</script>

<template>
  <div class="relative flex items-center justify-center">
    <div class="pulse-ring absolute size-[36px] rounded-full" />
    <div
      class="size-[26px] border-2 border-white dark:border-[#0C0C0C] rounded-full flex items-center justify-center shadow-lg cursor-grab select-none bg-amber-500"
    >
      <MessageSquareIcon class="text-white dark:text-[#0C0C0C] size-3.5" />
    </div>
  </div>
</template>

<style scoped>
div {
  pointer-events: all;
}

.pulse-ring {
  background: rgba(245, 158, 11, 0.3);
  animation: pulse-expand 2s ease-out infinite;
}

@keyframes pulse-expand {
  0% {
    transform: scale(0.8);
    opacity: 1;
  }
  100% {
    transform: scale(1.8);
    opacity: 0;
  }
}
</style>
