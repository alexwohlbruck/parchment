<script setup lang="ts">
defineProps<{ index: number; isFirst?: boolean }>()
const emit = defineEmits<{ remove: [] }>()

function onClick(e: MouseEvent) {
  e.stopPropagation()
  emit('remove')
}
</script>

<template>
  <div
    class="measure-dot relative flex size-4 cursor-grab items-center justify-center transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    role="button"
    tabindex="0"
    @click="onClick"
    @keydown.enter.space.prevent="emit('remove')"
  >
    <!-- Outer ring -->
    <span
      class="absolute inset-0 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
      :class="
        isFirst
          ? 'bg-primary-500 dark:bg-primary-500'
          : 'bg-primary-50 dark:bg-primary-700'
      "
      aria-hidden
    />
    <!-- Inner dot -->
    <span
      class="absolute inset-0 m-auto size-2 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
      :class="
        isFirst
          ? 'bg-primary-50 dark:bg-primary-950'
          : 'bg-primary-500 dark:bg-primary-500'
      "
      aria-hidden
    />
  </div>
</template>

<style scoped></style>
