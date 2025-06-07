<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
</script>

<template>
  <div class="flex items-center justify-center h-full w-full bg-muted/30">
    <div class="flex flex-col items-center space-y-4">
      <div class="flex items-center space-x-2">
        <Loader2 class="h-6 w-6 animate-spin text-primary" />
        <span class="text-lg font-medium text-foreground">Loading Map</span>
      </div>
      <p class="text-sm text-muted-foreground">Preparing map integrations...</p>
    </div>
  </div>
</template>
