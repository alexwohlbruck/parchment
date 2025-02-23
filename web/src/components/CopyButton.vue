<script setup lang="ts">
import { ref } from 'vue'
import { CopyIcon, CheckIcon } from 'lucide-vue-next'
import { TransitionFade } from '@morev/vue-transitions'
import { useAppService } from '@/services/app.service'

const props = defineProps<{
  text: string
  message?: string
}>()

const { toast } = useAppService()
const copied = ref(false)
const copyTimeoutId = ref<NodeJS.Timeout>()

async function copyToClipboard() {
  if (copyTimeoutId.value) {
    clearTimeout(copyTimeoutId.value)
  }

  await navigator.clipboard.writeText(props.text)
  toast.info(props.message || 'Copied to clipboard')
  copied.value = true

  copyTimeoutId.value = setTimeout(() => {
    copied.value = false
  }, 1000)
}
</script>

<template>
  <button
    @click="copyToClipboard"
    class="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
    title="Copy"
  >
    <TransitionFade mode="out-in" :duration="100">
      <CheckIcon v-if="copied" class="w-4 h-4 text-green-600" key="check" />
      <CopyIcon v-else class="w-4 h-4 text-muted-foreground" key="copy" />
    </TransitionFade>
  </button>
</template>
