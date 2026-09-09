<script setup lang="ts">
import { cn } from "@/lib/utils";
</script>

<template>
  <blockquote :class="cn('mt-6 border-l-2 pl-6 italic', $attrs.class ?? '')">
    <slot></slot>
  </blockquote>
</template>
