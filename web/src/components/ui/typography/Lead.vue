<script setup lang="ts">
import { cn } from "@/lib/utils";
</script>

<template>
  <p :class="cn('text-xl text-muted-foreground', $attrs.class ?? '')">
    <slot></slot>
  </p>
</template>
