<script setup lang="ts">
import { computed } from 'vue'
import { Code } from '@/components/ui/code'
import CopyButton from '@/components/CopyButton.vue'
import { AtSign } from 'lucide-vue-next'

interface Props {
  handle: string
  showIcon?: boolean
  copyMessage?: string
}

const props = withDefaults(defineProps<Props>(), {
  showIcon: true,
  copyMessage: 'Handle copied to clipboard',
})
</script>

<template>
  <div class="flex gap-2 items-center">
    <Code class="flex-1 p-3 text-sm font-mono flex items-center gap-2">
      <AtSign v-if="showIcon" class="h-4 w-4 text-muted-foreground shrink-0" />
      <span class="truncate">{{ handle }}</span>
    </Code>
    <CopyButton :text="handle" :message="copyMessage" variant="outline" />
  </div>
</template>

