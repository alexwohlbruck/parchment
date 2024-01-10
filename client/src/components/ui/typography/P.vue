<script setup lang="ts">
import { cn } from "@/lib/utils";
</script>

<template>
  <p :class="cn('leading-7 [&:not(:first-child)]:mt-6', $attrs.class ?? '')">
    <slot></slot>
  </p>
</template>
