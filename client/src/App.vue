<script setup lang="ts">
import Nav from "@/components/navigation/Navigation.vue";
</script>

<template>
  <div class="flex h-dvh">
    <div class="flex flex-col justify-center">
      <Nav class="z-20" />
    </div>

    <main class="flex-1">
      <RouterView />
    </main>
  </div>
</template>
