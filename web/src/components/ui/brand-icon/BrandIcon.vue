<script setup lang="ts">
import type { SimpleIcon } from 'simple-icons'

interface Props {
  icon: SimpleIcon
  size?: number
  class?: string
  useThemeColor?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 16,
  class: '',
  useThemeColor: false,
})
</script>

<template>
  <div
    :class="[props.class, useThemeColor && 'fill-foreground']"
    :style="{
      fill: useThemeColor ? undefined : `#${icon.hex}`,
      width: `${size}px`,
      height: `${size}px`,
    }"
    v-html="icon.svg"
  />
</template>
