<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Card } from '@/components/ui/card'
import { useObstructingComponent } from '@/composables/useObstructingComponent'
import { useCommandService } from '@/services/command.service'
import { useHotkeys } from '@/composables/useHotkeys'

const commandService = useCommandService()
const sheet = ref<HTMLElement | null>(null)
const emit = defineEmits<{
  (e: 'close'): void
}>()

useObstructingComponent(sheet, 'left-sheet')

useHotkeys([
  {
    key: 'esc',
    handler: () => emit('close'),
  },
])
</script>

<template>
  <Card
    ref="sheet"
    class="bg-muted shadow-none overflow-y-auto z-30 absolute top-0 left-0 w-full md:w-104 h-full pt-15.5 flex flex-col rounded-l-none border-foreground/5 border-l-0 border-y-0 justify-start"
  >
    <slot />
  </Card>
</template>
