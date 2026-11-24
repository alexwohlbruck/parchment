<script setup lang="ts">
import { useSheetPeek } from '@/composables/sheet/useSheetPeek'

const { peekRef } = useSheetPeek()
</script>

<template>
  <div ref="peekRef">
    <slot />
  </div>
</template>
