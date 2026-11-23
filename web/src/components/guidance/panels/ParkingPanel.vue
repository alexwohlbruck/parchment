<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { useParkingSearch } from '@/composables/guidance/useParkingSearch'
import { formatDurationLong } from '@/lib/time-format'
import { toast } from '@/lib/toast'
import type { ParkingOption } from '@/lib/guidance/parking'
import { useGuidanceContext } from '../context'

const emit = defineEmits<{ done: []; found: [] }>()
const { t } = useI18n()
const { parking: offer } = useGuidanceContext()
const { options, loading, failed, parking, search, park } = useParkingSearch()

const kindLabel = (option: ParkingOption) => t(`guidance.parking.kinds.${option.kind}`)
const name = (option: ParkingOption) => option.name ?? kindLabel(option)

function detail(option: ParkingOption) {
  const parts = [option.name ? kindLabel(option) : null]
  if (option.paid != null) parts.push(t(option.paid ? 'guidance.parking.paid' : 'guidance.parking.free'))
  return parts.filter(Boolean).join(' · ')
}

async function pick(option: ParkingOption) {
  if (await park(option, name(option))) emit('done')
  else toast.error(t('guidance.parking.failed'))
}

onMounted(async () => {
  const destination = offer.destination.value
  if (!destination) return
  await search(destination.location)
  if (options.value.length) emit('found')
})
</script>

<template>
  <div>
    <div v-if="loading" class="py-6 text-center text-sm text-muted-foreground">…</div>
    <div v-else-if="failed" class="py-6 text-center text-sm text-muted-foreground">{{ t('guidance.parking.unavailable') }}</div>
    <div v-else-if="!options.length" class="py-6 text-center text-sm text-muted-foreground">{{ t('guidance.parking.empty') }}</div>
    <ol v-else class="divide-y">
      <li v-for="(option, i) in options" :key="option.id" class="flex items-center gap-3 py-3">
        <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
          {{ i + 1 }}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            <span class="truncate text-sm font-medium">{{ name(option) }}</span>
            <span class="ml-auto shrink-0 text-sm font-medium tabular-nums">
              {{ t('guidance.parking.walk', { duration: formatDurationLong(Math.max(60, option.walkSeconds)) }) }}
            </span>
          </div>
          <div v-if="detail(option)" class="truncate text-xs text-muted-foreground">{{ detail(option) }}</div>
        </div>
        <Button variant="secondary" class="h-10 shrink-0 rounded-full px-4" :disabled="parking != null" @click="pick(option)">
          {{ t('guidance.parking.park') }}
        </Button>
      </li>
    </ol>
  </div>
</template>
