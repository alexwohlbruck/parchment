<script setup lang="ts">
import { cn } from "@/lib/utils";
</script>

<template>
  <h5
    :class="cn('scroll-m-20', $attrs.class ?? '')"
  >
    <slot></slot>
  </h5>
</template>
