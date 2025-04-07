<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Card } from '@/components/ui/card'
import { useObstructingComponent } from '@/composables/useObstructingComponent'

const sheet = ref<HTMLElement | null>(null)
const emit = defineEmits<{
  (e: 'close'): void
}>()

useObstructingComponent(sheet)
</script>

<template>
  <Card
    ref="sheet"
    class="bg-muted overflow-y-auto z-30 top-0 left-0 w-full md:w-[26rem] h-full pt-[3.5rem] flex flex-col rounded-l-none border-l-0 border-y-0 justify-center"
  >
    <slot />
  </Card>
</template>
