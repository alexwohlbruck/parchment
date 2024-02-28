<script setup lang="ts">
import { cn } from '@/lib/utils'
</script>

<template>
  <span :class="cn('leading-7', $attrs.class ?? '')">
    <slot></slot>
  </span>
</template>
