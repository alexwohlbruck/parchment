<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ItemRow } from '@/components/ui/item-row'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useParkingSearch } from '@/composables/guidance/useParkingSearch'
import { toast } from '@/lib/toast'
import type { ParkingOption } from '@/lib/guidance/parking'
import { useGuidanceContext } from '../context'

const emit = defineEmits<{ done: []; found: [] }>()
const { t } = useI18n()
const { parking: offer } = useGuidanceContext()
const { options, loading, failed, parking, search, park } = useParkingSearch()

const kindLabel = (option: ParkingOption) => t(`guidance.parking.kinds.${option.kind}`)
const title = (option: ParkingOption) => option.name ?? kindLabel(option)
const minutes = (option: ParkingOption) => Math.max(1, Math.round(option.walkSeconds / 60))

function detail(option: ParkingOption) {
  return [
    option.address !== option.name ? option.address : null,
    option.name ? kindLabel(option) : null,
    option.paid == null ? null : t(option.paid ? 'guidance.parking.paid' : 'guidance.parking.free'),
  ].filter(Boolean).join(' · ')
}

async function pick(option: ParkingOption) {
  if (parking.value) return
  if (await park(option, title(option))) emit('done')
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
  <div v-if="loading" class="space-y-1">
    <div v-for="i in 3" :key="i" class="flex items-center gap-3 px-2 py-3">
      <Skeleton class="size-7 rounded-full" />
      <div class="flex-1 space-y-1.5">
        <Skeleton class="h-3.5 w-2/5" />
        <Skeleton class="h-3 w-1/4" />
      </div>
      <Skeleton class="h-5 w-12" />
    </div>
  </div>
  <p v-else-if="failed || !options.length" class="py-6 text-center text-sm text-muted-foreground">
    {{ t(failed ? 'guidance.parking.unavailable' : 'guidance.parking.empty') }}
  </p>
  <ol v-else class="-mx-2">
    <li v-for="(option, i) in options" :key="option.id">
      <ItemRow
        as="button"
        type="button"
        variant="plain"
        size="md"
        class="rounded-2xl"
        interactive
        :has-details="!!detail(option)"
        :title="title(option)"
        :disabled="parking != null"
        :class="parking != null && parking !== option.id && 'opacity-50'"
        @click="pick(option)"
      >
        <template #icon>
          <span class="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
            {{ i + 1 }}
          </span>
        </template>
        <template v-if="detail(option)" #details="{ detailClass }">
          <span class="truncate text-muted-foreground" :class="detailClass">{{ detail(option) }}</span>
        </template>
        <template #trailing>
          <Spinner v-if="parking === option.id" class="size-5 shrink-0" />
          <div v-else class="shrink-0 text-right leading-tight">
            <div class="text-base font-semibold tabular-nums">{{ t('guidance.parking.minutes', { n: minutes(option) }) }}</div>
            <div class="text-xs text-muted-foreground">{{ t('guidance.parking.walking') }}</div>
          </div>
        </template>
      </ItemRow>
    </li>
  </ol>
</template>
