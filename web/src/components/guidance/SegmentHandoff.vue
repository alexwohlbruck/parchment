<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BikeIcon, CarFrontIcon, FootprintsIcon, TrainFrontIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { handoffText } from '@/lib/guidance/phrases'
import type { Handoff } from '@/lib/guidance/handoff'

const props = defineProps<{ handoff: Handoff }>()
const emit = defineEmits<{ settle: [] }>()
const { t } = useI18n()

const COUNTDOWN_MS = 10_000
const ICONS: Record<string, unknown> = { walking: FootprintsIcon, cycling: BikeIcon, biking: BikeIcon, driving: CarFrontIcon, transit: TrainFrontIcon }

const text = computed(() => handoffText(props.handoff, t as never))
const remaining = ref(1)
let frame: number | null = null
const startedAt = performance.now()

function tick(now: number) {
  remaining.value = Math.max(0, 1 - (now - startedAt) / COUNTDOWN_MS)
  if (remaining.value === 0) emit('settle')
  else frame = requestAnimationFrame(tick)
}

onMounted(() => {
  frame = requestAnimationFrame(tick)
})
onBeforeUnmount(() => {
  if (frame != null) cancelAnimationFrame(frame)
})
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
      <component :is="ICONS[handoff.nextMode] ?? FootprintsIcon" class="size-5" />
    </div>
    <div class="min-w-0 flex-1">
      <div class="text-base font-medium leading-snug">{{ text }}</div>
      <div v-if="handoff.docks != null" class="text-sm text-muted-foreground">
        {{ t('guidance.handoff.docksFree', handoff.docks) }}
      </div>
    </div>
    <Button variant="ghost" class="h-11 rounded-full px-3 text-muted-foreground" @click="emit('settle')">
      {{ t('guidance.handoff.notYet') }}
    </Button>
    <Button class="relative h-11 overflow-hidden rounded-full px-5" @click="emit('settle')">
      <span
        class="absolute inset-y-0 left-0 bg-white/20"
        :style="{ width: `${(1 - remaining) * 100}%` }"
        aria-hidden="true"
      />
      <span class="relative">{{ t('guidance.handoff.go') }}</span>
    </Button>
  </div>
</template>
