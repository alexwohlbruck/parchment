<script setup lang="ts">
import { computed } from 'vue'
import MakiIcon from '@/components/ui/item-icon/MakiIcon.vue'

const props = defineProps<{
  icon: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>()

// Presets reference several icon packs (maki-, temaki-, fas-…); only maki
// ships with the app, so anything else falls back to MakiIcon's marker.
const makiName = computed(() =>
  props.icon.startsWith('maki-') ? props.icon.slice(5) : props.icon,
)
</script>

<template>
  <MakiIcon :name="makiName" :size="size" />
</template>
