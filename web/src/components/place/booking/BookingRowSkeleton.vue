<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'

defineProps<{ priced?: boolean }>()
</script>

<template>
  <div class="flex h-12 items-center gap-3">
    <Skeleton class="size-5 rounded" />
    <div class="flex flex-1 flex-col gap-1.5">
      <Skeleton class="h-3.5 w-24" />
      <Skeleton class="h-3 w-16" />
    </div>
    <Skeleton v-if="priced" class="h-4 w-12" />
  </div>
</template>
