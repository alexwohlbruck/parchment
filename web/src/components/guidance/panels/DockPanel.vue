<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGuidanceStore } from '@/stores/guidance.store'
import { useResultMarkers } from '@/composables/guidance/useResultMarkers'
import { AUTO_PICK_SECONDS, type StationOption } from '@/lib/guidance/dock-watch'
import { toast } from '@/lib/toast'
import { useGuidanceContext } from '../context'
import AutoPickButton from './AutoPickButton.vue'
import PickList, { type PickItem } from './PickList.vue'

const emit = defineEmits<{ done: []; found: [] }>()
const { t } = useI18n()
const guidance = useGuidanceStore()
const { docks } = useGuidanceContext()

/** Opened because the station ran out, rather than from the menu. */
const auto = ref(false)
const touched = ref(false)
const picking = ref<string | null>(null)

const need = computed(() => docks.watched.value?.need ?? 'dock')
const stationName = computed(() => docks.station.value?.name ?? docks.watched.value?.name ?? '')
const warning = computed(() =>
  docks.risk.value === 'ok' ? null : t(`guidance.docks.${docks.risk.value === 'gone' ? 'gone' : 'atRisk'}.${need.value}`, { station: stationName.value }),
)

const countLabel = (option: StationOption) =>
  t(`guidance.docks.${need.value === 'dock' ? 'docks' : 'bikes'}`, { n: option.available }, option.available)
const items = computed<PickItem[]>(() =>
  docks.options.value.map(option => ({ id: option.id, title: option.name, detail: countLabel(option), walkSeconds: option.walkSeconds })),
)
const best = computed(() => docks.options.value[0] ?? null)
const counting = computed(() => auto.value && guidance.preferences.autoSwitchDocks && !touched.value && !!best.value && !picking.value)

useResultMarkers(() => docks.options.value.map(o => o.location))

async function pick(option: StationOption | null) {
  if (!option || picking.value) return
  picking.value = option.id
  try {
    if (await docks.pick(option)) emit('done')
    else toast.error(t('guidance.docks.failed'))
  } finally {
    picking.value = null
  }
}

const pickItem = (item: PickItem) => pick(docks.options.value.find(o => o.id === item.id) ?? null)

watch(
  docks.pickRequested,
  requested => {
    if (!requested) return
    auto.value = true
    touched.value = false
    docks.pickRequested.value = false
  },
  { immediate: true },
)
watch(docks.watched, watched => !watched && emit('done'))

onMounted(async () => {
  if (!docks.options.value.length) await docks.loadAlternatives()
  if (docks.options.value.length) emit('found')
})
</script>

<template>
  <div class="space-y-3" @pointerdown.capture="touched = true" @wheel.passive="touched = true" @keydown.capture="touched = true">
    <p v-if="warning" class="text-sm font-medium text-amber-600 dark:text-amber-400">{{ warning }}</p>
    <PickList
      :items="items"
      :loading="docks.loadingAlternatives.value && !items.length"
      :busy="picking"
      :empty="t(`guidance.docks.none.${need}`)"
      @pick="pickItem"
    />
    <AutoPickButton v-if="auto && best" :seconds="AUTO_PICK_SECONDS" :running="counting" :disabled="!!picking" @fire="pick(best)">
      {{ t('guidance.docks.goTo', { station: best.name }) }}
    </AutoPickButton>
  </div>
</template>
