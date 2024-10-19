<script setup lang="ts">
import { cn } from "@/lib/utils";
</script>

<template>
  <h3
    :class="
      cn(
        'scroll-m-20 text-2xl font-semibold tracking-tight',
        $attrs.class ?? ''
      )
    "
  >
    <slot></slot>
  </h3>
</template>
