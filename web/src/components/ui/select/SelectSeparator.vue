<script setup lang="ts">
import { SelectSeparator, type SelectSeparatorProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<SelectSeparatorProps & { class?: string }>()
</script>

<template>
  <SelectSeparator :class="cn('-mx-1 my-1 h-px bg-muted', props.class)" />
</template>
