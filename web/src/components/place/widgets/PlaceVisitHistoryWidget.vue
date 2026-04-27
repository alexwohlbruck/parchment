<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { HistoryIcon, MapPinCheckInsideIcon } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import PlaceSection from '@/components/place/details/PlaceSection.vue'
import { Skeleton } from '@/components/ui/skeleton'
import { useIntegrationsStore } from '@/stores/integrations.store'
import {
  fetchPlaceVisitHistory,
  MissingDawarichConfigError,
} from '@/services/timeline.service'
import type { Place } from '@/types/place.types'
import type { PlaceVisitHistory } from '@server/types/location-history.types'

dayjs.extend(relativeTime)

const props = defineProps<{
  place: Partial<Place>
}>()

const { t } = useI18n()
const router = useRouter()
const integrationsStore = useIntegrationsStore()

const data = ref<PlaceVisitHistory | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let activeController: AbortController | null = null

// Re-fetch any time the place's coordinate changes — covers the user
// navigating between place detail views without unmounting the widget.
const coord = computed(() => props.place.geometry?.value?.center ?? null)

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
    fetchPlaceVisitHistory({
      lat: c.lat,
      lng: c.lng,
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

// ── Display ─────────────────────────────────────────────────────────────────
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

function visitDayLabel(iso: string): string {
  const d = dayjs(iso)
  if (d.isSame(dayjs(), 'day')) return t('timeline.today')
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday'
  return d.format('MMM D, YYYY')
}

function visitTimeLabel(visit: { startTime: string; endTime: string }): string {
  return `${dayjs(visit.startTime).format('h:mm A')} – ${dayjs(visit.endTime).format('h:mm A')}`
}

function viewOnTimeline(visit: { startTime: string }) {
  router.push({
    name: AppRoute.TIMELINE,
    query: { day: dayjs(visit.startTime).format('YYYY-MM-DD') },
  })
}
</script>

<template>
  <Skeleton v-if="loading" class="rounded-lg" style="min-height: 120px" />

  <!-- Hide entirely when no integration, no data, or no visits — silent
       absence is better UX than a "0 visits" empty state. -->
  <PlaceSection v-else-if="hasContent">
    <template #main>
      <div class="flex items-start gap-3">
        <div
          class="shrink-0 w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center"
        >
          <MapPinCheckInsideIcon class="w-4.5 h-4.5" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-semibold text-sm leading-snug">
              You've been here
              {{ data!.totalVisits }}
              {{ data!.totalVisits === 1 ? 'time' : 'times' }}
            </span>
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
      </div>

      <div
        v-if="data!.recentVisits.length > 1"
        class="mt-3 pt-3 border-t border-border/60 space-y-1.5"
      >
        <button
          v-for="visit in data!.recentVisits"
          :key="visit.id"
          type="button"
          class="w-full text-left flex items-center justify-between gap-3 px-1 py-1 rounded hover:bg-muted/50 transition-colors"
          @click="viewOnTimeline(visit)"
        >
          <span class="text-xs font-medium">{{ visitDayLabel(visit.startTime) }}</span>
          <span class="text-xs text-muted-foreground tabular-nums">
            {{ visitTimeLabel(visit) }}
          </span>
        </button>
      </div>
    </template>
  </PlaceSection>
</template>
