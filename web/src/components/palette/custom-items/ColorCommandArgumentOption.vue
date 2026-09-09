<script lang="ts" setup>
import { computed, toRefs } from 'vue'
import { CommandArgumentOption } from '@/types/command.types'
import { palette } from '@/lib/palette'
import type { PaletteColor } from '@/lib/palette'

const props = defineProps<{
  argumentOption: CommandArgumentOption
}>()
const { argumentOption } = toRefs(props)
const color = computed(() => palette[argumentOption.value.value as PaletteColor]?.[600] ?? palette.cobalt[600])
</script>

<template>
  <div class="flex-1 flex items-center gap-2">
    <span
      class="size-2.5 rounded-full"
      :style="`background-color: ${color}`"
    ></span>
    <span class="font-semibold">{{ argumentOption.name }}</span>
  </div>
</template>
