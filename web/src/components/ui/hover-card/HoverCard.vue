<script setup lang="ts">
import {
  HoverCardRoot,
  type HoverCardRootProps,
  useForwardProps,
} from 'reka-ui'

const props = defineProps<HoverCardRootProps>()
const forwarded = useForwardProps(props)
</script>

<template>
  <HoverCardRoot v-bind="forwarded">
    <slot />
  </HoverCardRoot>
</template>
