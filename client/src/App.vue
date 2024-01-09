<script setup lang="ts">
import Nav from "./components/Nav.vue";
</script>

<template>
  <div class="flex h-dvh gap-2">
    <div class="flex flex-col justify-center">
      <Nav class="z-20" />
    </div>

    <main class="flex-1">
      <RouterView />
    </main>
  </div>
</template>
