<script lang="ts" setup>
import { computed, toRefs } from 'vue'
import { CommandArgumentOption } from '@/types/command.types'
import { colors } from '@/lib/registry/colors'

const props = defineProps<{
  argumentOption: CommandArgumentOption
}>()
const { argumentOption } = toRefs(props)
const color = computed(() => colors[argumentOption.value.value][6].hsl)
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
