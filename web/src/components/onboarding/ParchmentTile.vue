<script setup lang="ts">
import ParchmentLogo from '@/assets/parchment.svg?component'
</script>

<template>
  <div class="parchment-tile flex items-center justify-center rounded-2xl shadow-sm">
    <ParchmentLogo class="size-[46%]" />
  </div>
</template>

<style scoped>
.parchment-tile {
  color: #6b4f2a;
  background: linear-gradient(135deg, #f7efe0, #ead9b9);
  box-shadow: inset 0 0 0 1px #6b4f2a1f, 0 6px 16px -6px #2a1d0e40;
}
</style>
