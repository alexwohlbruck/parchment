<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useParkingSearch } from '@/composables/guidance/useParkingSearch'
import { toast } from '@/lib/toast'
import type { ParkingOption } from '@/lib/guidance/parking'
import { useGuidanceContext } from '../context'
import PickList, { type PickItem } from './PickList.vue'

const emit = defineEmits<{ done: []; found: [] }>()
const { t } = useI18n()
const { parking: offer } = useGuidanceContext()
const { options, loading, failed, parking, search, park } = useParkingSearch()

const kindLabel = (option: ParkingOption) => t(`guidance.parking.kinds.${option.kind}`)

function detail(option: ParkingOption) {
  return [
    option.address !== option.name ? option.address : null,
    option.name ? kindLabel(option) : null,
    option.paid == null ? null : t(option.paid ? 'guidance.parking.paid' : 'guidance.parking.free'),
  ].filter(Boolean).join(' · ')
}

const items = computed<PickItem[]>(() =>
  options.value.map(option => ({ id: option.id, title: option.name ?? kindLabel(option), detail: detail(option), walkSeconds: option.walkSeconds })),
)

async function pick(item: PickItem) {
  const option = options.value.find(o => o.id === item.id)
  if (!option || parking.value) return
  if (await park(option, item.title)) emit('done')
  else toast.error(t('guidance.parking.failed'))
}

onMounted(async () => {
  const destination = offer.destination.value
  if (!destination) return
  await search(destination)
  if (options.value.length) emit('found')
})
</script>

<template>
  <PickList
    :items="items"
    :loading="loading"
    :busy="parking"
    :empty="t(failed ? 'guidance.parking.unavailable' : `guidance.parking.${offer.destination.value?.vehicle ?? 'car'}.empty`)"
    @pick="pick"
  />
</template>
