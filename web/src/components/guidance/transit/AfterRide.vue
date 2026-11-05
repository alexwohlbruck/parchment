<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import RouteBullet from '@/components/transit/bullets/RouteBullet.vue'
import TransferChip from '@/components/transit/trip/TransferChip.vue'
import { formatDurationLong, formatDurationShort } from '@/lib/time-format'
import type { AfterRide } from '@/lib/guidance/after-ride'

const props = defineProps<{ after: AfterRide | null }>()
defineEmits<{ alight: [] }>()
const { t } = useI18n()

const duration = (sec: number) => (sec < 60 ? formatDurationShort(sec) : formatDurationLong(sec))
const TRAVEL_KEYS: Record<string, string> = { walking: 'walk', cycling: 'cycle', biking: 'cycle', driving: 'drive' }

const line = computed(() => {
  const after = props.after
  const place = (to?: string) => (to ? ` ${t('guidance.transit.toPlace', { place: to })}` : '')
  switch (after?.kind) {
    case 'walk':
      return t('guidance.transit.after.walk', { duration: duration(after.seconds) }) + place(after.to)
    case 'travel':
      return t(`guidance.transit.after.${TRAVEL_KEYS[after.mode] ?? 'travel'}`, { duration: duration(after.seconds) }) + place(after.to)
    case 'arrive':
      return after.to ? t('guidance.transit.after.arriveAt', { place: after.to }) : t('guidance.transit.after.arrive')
    default:
      return null
  }
})
</script>

<template>
  <div class="flex items-center gap-3">
    <div v-if="after" class="min-w-0 flex-1 text-sm">
      <template v-if="after.kind === 'transfer'">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="shrink-0 text-muted-foreground">{{ t('guidance.transit.after.change') }}</span>
          <RouteBullet class="shrink-0" :label="after.line.name" :color="after.line.color" :text-color="after.line.textColor" />
          <span v-if="after.line.toward" class="truncate font-medium">{{ after.line.toward }}</span>
        </div>
        <TransferChip v-if="after.transfer" class="mt-1.5" :transfer="after.transfer" />
        <div v-else-if="after.walkSec" class="mt-0.5 text-muted-foreground tabular-nums">
          {{ t('guidance.transit.after.walkFirst', { duration: duration(after.walkSec) }) }}
        </div>
      </template>
      <template v-else>
        <div class="truncate font-medium">{{ line }}</div>
        <div v-if="after.kind === 'walk' && after.exit" class="truncate text-muted-foreground">
          {{ t('guidance.transit.after.exit', { exit: after.exit }) }}
        </div>
      </template>
    </div>
    <Button variant="secondary" class="ml-auto h-10 shrink-0 rounded-full px-4" @click="$emit('alight')">
      {{ t('guidance.transit.gotOff') }}
    </Button>
  </div>
</template>
