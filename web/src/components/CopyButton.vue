<script setup lang="ts">
import { CopyIcon, CheckIcon } from 'lucide-vue-next'
import { useClipboard } from '@/composables/useClipboard'

const props = defineProps<{
  text: string
  message?: string
}>()

const { copied, copy } = useClipboard()
</script>

<template>
  <button
    @click.stop="copy(props.text, props.message)"
    class="p-1 hover:bg-muted rounded cursor-pointer"
    title="Copy"
  >
    <span class="relative flex items-center justify-center w-4 h-4">
      <Transition name="copy-swap">
        <CheckIcon v-if="copied" class="absolute w-4 h-4 text-forest-600" key="check" />
        <CopyIcon v-else class="absolute w-4 h-4 text-muted-foreground" key="copy" />
      </Transition>
    </span>
  </button>
</template>

<style scoped>
.copy-swap-enter-active,
.copy-swap-leave-active {
  transition: all 0.15s ease;
}

.copy-swap-enter-from {
  opacity: 0;
  filter: blur(4px);
  transform: scale(0.5);
}

.copy-swap-leave-to {
  opacity: 0;
  filter: blur(4px);
  transform: scale(0.5);
}
</style>
