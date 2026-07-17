<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, ref, watch } from 'vue'
import axios from 'axios'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useI18n } from 'vue-i18n'
import { HistoryIcon, ChevronRightIcon } from 'lucide-vue-next'
import PlaceSection from '@/components/place/details/PlaceSection.vue'
import { Skeleton } from '@/components/ui/skeleton'
import { useIntegrationsStore } from '@/stores/integrations.store'
import {
  fetchPlaceVisitHistory,
  MissingDawarichConfigError,
} from '@/services/timeline.service'
import { usePlaceTabs } from '@/composables/usePlaceTabs'
import PlaceVisitHistoryPage from '@/components/place/pages/PlaceVisitHistoryPage.vue'
import type { Place } from '@/types/place.types'
import type { PlaceVisitHistory } from '@server/types/location-history.types'

dayjs.extend(relativeTime)

const props = defineProps<{
  place: Partial<Place>
}>()

const { t } = useI18n()
const integrationsStore = useIntegrationsStore()
const { register, unregister, activate } = usePlaceTabs()

const data = ref<PlaceVisitHistory | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let activeController: AbortController | null = null

const geometry = computed(() => props.place.geometry?.value ?? null)
const coord = computed(() => geometry.value?.center ?? null)

watch(
  [coord, () => integrationsStore.isLocationHistoryActive],
  ([c, active]) => {
    if (activeController) activeController.abort()
    data.value = null
    error.value = null
    if (!active || !c) return

    activeController = new AbortController()
    const controller = activeController
    loading.value = true
    const b = geometry.value?.bounds
    fetchPlaceVisitHistory({
      lat: c.lat,
      lng: c.lng,
      bounds: b
        ? {
            minLat: b.minLat,
            minLng: b.minLng,
            maxLat: b.maxLat,
            maxLng: b.maxLng,
          }
        : undefined,
      signal: controller.signal,
    })
      .then((result) => {
        if (controller !== activeController) return
        data.value = result
      })
      .catch((err: unknown) => {
        if (axios.isCancel(err)) return
        if (err instanceof MissingDawarichConfigError) return
        error.value =
          err instanceof Error ? err.message : 'Failed to load visit history'
      })
      .finally(() => {
        if (controller === activeController) loading.value = false
      })
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  activeController?.abort()
})

const lastVisitLabel = computed(() => {
  const v = data.value?.lastVisit
  return v ? dayjs(v).fromNow() : null
})

const firstVisitLabel = computed(() => {
  const v = data.value?.firstVisit
  return v ? dayjs(v).format('MMM YYYY') : null
})

const totalDurationLabel = computed(() => {
  const sec = data.value?.totalDuration ?? 0
  if (sec < 3600) return `${Math.round(sec / 60)} min`
  const hours = Math.round(sec / 3600)
  if (hours < 48) return `${hours} hr`
  return `${Math.round(hours / 24)} days`
})

const hasContent = computed(() => (data.value?.totalVisits ?? 0) > 0)

const TAB_ID = 'visits'
watch(
  hasContent,
  (has) => {
    if (has) {
      register({
        id: TAB_ID,
        label: t('place.tabs.visits'),
        component: markRaw(PlaceVisitHistoryPage),
        props: { place: props.place },
        order: 30,
      })
    } else {
      unregister(TAB_ID)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => unregister(TAB_ID))

function openFullHistory() {
  activate(TAB_ID)
}
</script>

<template>
  <Skeleton v-if="loading" class="rounded-lg" style="min-height: 120px" />

  <PlaceSection v-else-if="hasContent">
    <template #main>
      <button
        type="button"
        class="w-full text-left flex items-start gap-3 group"
        @click="openFullHistory"
      >
        <div
          class="shrink-0 w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center"
        >
          <HistoryIcon class="w-4.5 h-4.5" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-sm leading-snug">
              <template v-if="data!.totalVisits === 1">
                You've visited once
              </template>
              <template v-else>
                You've visited {{ data!.totalVisits }} times
              </template>
            </span>
            <ChevronRightIcon class="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
          <div class="text-xs text-muted-foreground mt-0.5 tabular-nums">
            <template v-if="lastVisitLabel">Last visit {{ lastVisitLabel }}</template>
            <template v-if="firstVisitLabel && data!.totalVisits > 1">
              <span class="text-muted-foreground/40 mx-1">·</span>
              Since {{ firstVisitLabel }}
            </template>
            <span class="text-muted-foreground/40 mx-1">·</span>
            {{ totalDurationLabel }} total
          </div>
        </div>
      </button>
    </template>
  </PlaceSection>
</template>
