<script setup lang="ts">
defineProps<{
  customClass?: string
}>()
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    :class="customClass"
  >
    <!-- North arrow (more opaque) -->
    <path
      d="M12 1.25L7.25 10.75H16.75L12 1.25Z"
      fill="currentColor"
      fill-opacity="0.9"
    />
    <!-- South arrow (less opaque) -->
    <path
      d="M12 22.75L16.75 13.25H7.25L12 22.75Z"
      fill="currentColor"
      fill-opacity="0.5"
    />
  </svg>
</template>
