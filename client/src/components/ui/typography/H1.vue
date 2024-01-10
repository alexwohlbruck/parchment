<script setup lang="ts">
import { cn } from "@/lib/utils";
</script>

<template>
  <h1
    :class="
      cn(
        'scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl',
        $attrs.class ?? ''
      )
    "
  >
    <slot></slot>
  </h1>
</template>
