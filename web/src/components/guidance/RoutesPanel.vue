<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { formatDurationCompact } from '@/lib/time-format'
import { currentCandidate } from '@/lib/guidance/alternatives'
import type { useAlternativeRoutes } from '@/composables/guidance/useAlternativeRoutes'

const props = defineProps<{ alternatives: ReturnType<typeof useAlternativeRoutes> }>()
const emit = defineEmits<{ done: [] }>()
const { t } = useI18n()

const rows = computed(() => {
  const list = props.alternatives.candidates.value
  const current = currentCandidate(list)
  const baseline = current?.metrics.duration ?? props.alternatives.current.value?.remaining ?? 0
  return list.map(c => {
    const delta = c.metrics.duration - baseline
    const isCurrent = c === current
    return {
      candidate: c,
      isCurrent,
      delta: Math.abs(delta) < 30
        ? t('guidance.alternatives.sameTime')
        : t(`guidance.alternatives.${delta < 0 ? 'faster' : 'slower'}`, { duration: formatDurationCompact(Math.abs(delta)) }),
      protectedShare: Math.round(c.metrics.protectedShare * 100),
    }
  })
})

onMounted(() => void props.alternatives.fetchCandidates())

function take(row: (typeof rows.value)[number]) {
  const index = props.alternatives.current.value?.span.index
  if (index == null) return
  if (!row.isCurrent) props.alternatives.take(index, row.candidate.route)
  emit('done')
}
</script>

<template>
  <div class="mt-4 space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="text-base font-medium">{{ t('guidance.alternatives.title') }}</h3>
      <Button variant="ghost" size="sm" @click="alternatives.preview(null); emit('done')">{{ t('guidance.ahead.done') }}</Button>
    </div>
    <div v-if="alternatives.loading.value && !rows.length" class="py-6 text-center text-sm text-muted-foreground">…</div>
    <div v-else-if="!rows.length" class="py-6 text-center text-sm text-muted-foreground">{{ t('guidance.alternatives.empty') }}</div>
    <ol v-else class="divide-y">
      <li v-for="(row, i) in rows" :key="i">
        <button
          class="flex w-full items-center gap-3 py-3 text-left"
          @pointerenter="alternatives.preview(row.isCurrent ? null : row.candidate.route)"
          @click="take(row)"
        >
          <div class="min-w-0 flex-1">
            <div class="font-medium">
              {{ formatDurationCompact(row.candidate.metrics.duration) }}
              <span class="ml-1 text-sm font-normal text-muted-foreground">
                {{ row.isCurrent ? t('guidance.alternatives.current') : row.delta }}
              </span>
            </div>
            <div class="truncate text-sm text-muted-foreground">
              <template v-if="row.candidate.metrics.via">{{ t('guidance.alternatives.via', { street: row.candidate.metrics.via }) }}</template>
              <template v-if="row.protectedShare > 0"> · {{ t('guidance.alternatives.protectedShare', { n: row.protectedShare }) }}</template>
            </div>
          </div>
        </button>
      </li>
    </ol>
  </div>
</template>
