<script setup lang="ts">
import { SelectGroup, type SelectGroupProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<SelectGroupProps & { class?: string }>()
</script>

<template>
  <SelectGroup :class="cn('p-1 w-full', props.class)" v-bind="props">
    <slot />
  </SelectGroup>
</template>
