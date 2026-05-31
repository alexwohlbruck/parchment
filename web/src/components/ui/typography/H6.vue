<script setup lang="ts">
import { cn } from "@/lib/utils";
</script>

<template>
  <h6
    :class="
      cn('scroll-m-20 text-sm', $attrs.class ?? '')
    "
  >
    <slot></slot>
  </h6>
</template>
