<script setup lang="ts">
import { cn } from '@/lib/utils'
</script>

<template>
  <p
    :class="
      cn(
        'scroll-m-20 text-xs tracking-tight text-muted-foreground',
        $attrs.class ?? '',
      )
    "
  >
    <slot></slot>
  </p>
</template>
