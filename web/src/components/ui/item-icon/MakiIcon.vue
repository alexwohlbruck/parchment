<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: 'xs' | 'sm' | 'md' | 'lg'
  }>(),
  {
    size: 'md',
  },
)

// Import all maki SVGs as raw strings at build time
const svgModules = import.meta.glob(
  '/node_modules/@mapbox/maki/icons/*.svg',
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

// Build a lookup map: icon name -> SVG string
const svgMap: Record<string, string> = {}
for (const [path, svg] of Object.entries(svgModules)) {
  const name = path.split('/').pop()?.replace('.svg', '') || ''
  svgMap[name] = svg
}

const svgContent = computed(() => {
  return svgMap[props.name] || svgMap['marker'] || ''
})

const sizeClass = computed(() => {
  switch (props.size) {
    case 'xs':
      return 'size-3'
    case 'sm':
      return 'size-4'
    case 'lg':
      return 'size-6'
    case 'md':
    default:
      return 'size-5'
  }
})
</script>

<template>
  <div
    :class="sizeClass"
    class="inline-flex items-center justify-center shrink-0 [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-current"
    v-html="svgContent"
  />
</template>
