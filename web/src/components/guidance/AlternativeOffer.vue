<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { formatDurationCompact } from '@/lib/time-format'
import type { Offer } from '@/lib/guidance/alternatives'

const props = defineProps<{ offer: Offer<unknown>; seconds: number }>()
defineEmits<{ accept: []; dismiss: [] }>()
const { t } = useI18n()

const headline = computed(() =>
  props.offer.reason === 'faster'
    ? t('guidance.alternatives.faster', { duration: formatDurationCompact(props.offer.saved) })
    : t(`guidance.alternatives.${props.offer.reason}`),
)

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
  <div class="pointer-events-auto flex items-center gap-3 rounded-2xl bg-background/95 p-3 shadow-lg backdrop-blur">
    <div class="min-w-0 flex-1">
      <div class="font-medium leading-snug">{{ headline }}</div>
      <div v-if="offer.via" class="truncate text-sm text-muted-foreground">
        {{ t('guidance.alternatives.via', { street: offer.via }) }}
      </div>
    </div>
    <Button class="relative h-10 overflow-hidden rounded-full px-4" @click="$emit('accept')">
      <span class="absolute inset-y-0 left-0 bg-white/20" :style="{ width: `${elapsed * 100}%` }" aria-hidden="true" />
      <span class="relative">{{ t('guidance.alternatives.switch') }}</span>
    </Button>
    <Button size="icon" variant="ghost" class="size-10 rounded-full" :aria-label="t('guidance.ahead.done')" @click="$emit('dismiss')">
      <XIcon class="size-4" />
    </Button>
  </div>
</template>
