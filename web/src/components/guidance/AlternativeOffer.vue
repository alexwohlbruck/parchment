<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const props = defineProps<{ headline: string; detail?: string | null; seconds: number }>()
defineEmits<{ accept: []; dismiss: [] }>()
const { t } = useI18n()

const elapsed = ref(0)
let frame: number | null = null
const startedAt = performance.now()
function tick(now: number) {
  elapsed.value = Math.min(1, (now - startedAt) / (props.seconds * 1000))
  if (elapsed.value < 1) frame = requestAnimationFrame(tick)
}
onMounted(() => (frame = requestAnimationFrame(tick)))
onBeforeUnmount(() => frame != null && cancelAnimationFrame(frame))
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="min-w-0 flex-1">
      <div class="font-medium leading-snug">{{ headline }}</div>
      <div v-if="detail" class="truncate text-sm text-muted-foreground">{{ detail }}</div>
    </div>
    <Button class="h-12 rounded-full px-5" @click="$emit('accept')">
      {{ t('guidance.alternatives.switch') }}
    </Button>
    <Button size="icon" variant="ghost" class="relative size-12 rounded-full" :aria-label="t('guidance.menu.close')" @click="$emit('dismiss')">
      <svg class="absolute inset-0 size-full -rotate-90 text-muted-foreground/40" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="2" pathLength="1" stroke-dasharray="1" :stroke-dashoffset="elapsed" />
      </svg>
      <XIcon class="size-4" />
    </Button>
  </div>
</template>
