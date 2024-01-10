<script setup lang="ts">
import { cn } from "@/lib/utils";
</script>

<template>
  <h4
    :class="
      cn('scroll-m-20 text-xl font-semibold tracking-tight', $attrs.class ?? '')
    "
  >
    <slot></slot>
  </h4>
</template>
