<script setup lang="ts">
import { cn } from "@/lib/utils";
</script>

<template>
  <h6
    :class="
      cn('scroll-m-20 text-sm tracking-tight font-medium', $attrs.class ?? '')
    "
  >
    <slot></slot>
  </h6>
</template>
