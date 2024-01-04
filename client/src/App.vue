<script setup lang="ts">
import { useMagicKeys } from "@vueuse/core";
import { ref, watch } from "vue";
import Palette from "./components/Palette.vue";

import Sidebar from "./components/Sidebar.vue";
</script>

<template>
  <div class="flex h-dvh gap-2">
    <div class="flex flex-col justify-center">
      <Sidebar class="z-20" />
    </div>

    <main class="flex-1">
      <RouterView />
    </main>
  </div>

  <Palette />
</template>
