<script setup lang="ts">
import { cn } from "@/lib/utils";
</script>

<template>
  <h2
    :class="
      cn(
        'scroll-m-20 pb-2 text-3xl font-bold tracking-tight transition-colors first:mt-0',
        $attrs.class ?? ''
      )
    "
  >
    <slot></slot>
  </h2>
</template>
