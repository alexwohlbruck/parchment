<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeftRight } from 'lucide-vue-next'
import { transferSummary } from '@/lib/transit/station/transfer'
import { formatDurationShort } from '@/lib/time-format'
import type { TransitTransfer } from '@server/types/station-guidance.types'

const props = defineProps<{ transfer: TransitTransfer }>()
const { t } = useI18n()

const summary = computed(() => transferSummary(props.transfer))

const parts = computed(() => {
  const s = summary.value
  const out: string[] = []
  if (s.seconds != null) out.push(`${s.estimate ? '≈ ' : ''}${formatDurationShort(s.seconds)}`)
  if (s.viaStreet) out.push(t('directions.station.viaStreet'))
  if (s.kind === 'reenter') {
    out.push(t(s.reentryFree === true ? 'directions.station.reentryFree'
      : s.reentryFree === false ? 'directions.station.reentryPaid'
        : 'directions.station.reentryUnknown'))
  }
  return out
})
</script>

<template>
  <span
    class="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-[11px] leading-none text-muted-foreground"
    :title="summary.estimate ? t('directions.station.estimated') : undefined"
  >
    <ArrowLeftRight class="size-3 shrink-0" />
    <span class="font-medium text-foreground/80 whitespace-nowrap">{{ t(`directions.station.transfer.${summary.kind}`) }}</span>
    <span v-for="part in parts" :key="part" class="truncate tabular-nums">· {{ part }}</span>
  </span>
</template>
