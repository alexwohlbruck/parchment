<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useIntegrationsStore } from '@/stores/integrations.store'
import {
  fetchPlaceVisitHistory,
  MissingDawarichConfigError,
} from '@/services/timeline.service'
import type { Place } from '@/types/place.types'
import type {
  PlaceVisitHistory,
  PlaceVisitSummary,
} from '@server/types/location-history.types'
import PanelLayout from '@/components/layouts/PanelLayout.vue'
import SheetPageHeader from '@/components/place/SheetPageHeader.vue'

dayjs.extend(relativeTime)

const props = defineProps<{
  place: Partial<Place>
  /** When rendered inside a place tab: drop the page chrome (header/padding). */
  embedded?: boolean
}>()

const { t } = useI18n()
const router = useRouter()
const integrationsStore = useIntegrationsStore()

const data = ref<PlaceVisitHistory | null>(null)
const loading = ref(true)
let activeController: AbortController | null = null

const geometry = computed(() => props.place.geometry?.value ?? null)
const coord = computed(() => geometry.value?.center ?? null)

watch(
  [coord, () => integrationsStore.isLocationHistoryActive],
  ([c, active]) => {
    if (activeController) activeController.abort()
    data.value = null
    if (!active || !c) return

    activeController = new AbortController()
    const controller = activeController
    loading.value = true
    const b = geometry.value?.bounds
    fetchPlaceVisitHistory({
      lat: c.lat,
      lng: c.lng,
      bounds: b
        ? { minLat: b.minLat, minLng: b.minLng, maxLat: b.maxLat, maxLng: b.maxLng }
        : undefined,
      recentLimit: 100,
      signal: controller.signal,
    })
      .then(result => {
        if (controller !== activeController) return
        data.value = result
      })
      .catch((err: unknown) => {
        if (axios.isCancel(err)) return
        if (err instanceof MissingDawarichConfigError) return
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

// ── Stats ──────────────────────────────────────────────────────────────────
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

// ── Day grouping ───────────────────────────────────────────────────────────
// Visits arrive newest-first; multiple in the same calendar day are grouped
// under a single card so the date isn't repeated for every row.
interface VisitDay {
  iso: string // YYYY-MM-DD, used as the key
  date: dayjs.Dayjs
  visits: PlaceVisitSummary[]
}

const visitDays = computed<VisitDay[]>(() => {
  const list = data.value?.recentVisits ?? []
  const byDay = new Map<string, VisitDay>()
  for (const v of list) {
    const d = dayjs(v.startTime)
    const iso = d.format('YYYY-MM-DD')
    let entry = byDay.get(iso)
    if (!entry) {
      entry = { iso, date: d, visits: [] }
      byDay.set(iso, entry)
    }
    entry.visits.push(v)
  }
  return Array.from(byDay.values())
})

// ── Formatters ─────────────────────────────────────────────────────────────
function dayHeading(date: dayjs.Dayjs): string {
  if (date.isSame(dayjs(), 'day')) return t('timeline.today')
  if (date.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday'
  // Include year only when it's not the current year, to keep the header tight.
  if (date.isSame(dayjs(), 'year')) return date.format('ddd, MMM D')
  return date.format('ddd, MMM D, YYYY')
}

function visitTimeLabel(visit: PlaceVisitSummary): string {
  return `${dayjs(visit.startTime).format('h:mm A')} – ${dayjs(visit.endTime).format('h:mm A')}`
}

function visitDurationLabel(visit: PlaceVisitSummary): string {
  // Prefer the server-provided duration; fall back to start/end diff.
  const sec = visit.duration
    ?? Math.max(0, dayjs(visit.endTime).diff(dayjs(visit.startTime), 'second'))
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)} min`
  const hours = Math.floor(sec / 3600)
  const mins = Math.round((sec % 3600) / 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function viewOnTimeline(visit: PlaceVisitSummary) {
  router.push({
    name: AppRoute.TIMELINE,
    query: { day: dayjs(visit.startTime).format('YYYY-MM-DD') },
  })
}
</script>

<template>
  <component :is="embedded ? 'div' : PanelLayout">
    <SheetPageHeader v-if="!embedded" title="Visit History" />

    <Skeleton v-if="loading" class="rounded-lg" style="min-height: 200px" />

    <template v-else-if="data && data.totalVisits > 0">
      <!-- Stats card: hero count + three meta facts -->
      <Card class="mb-4">
        <CardContent class="p-4">
          <div class="flex items-baseline gap-2">
            <span class="text-3xl font-semibold tabular-nums leading-none">
              {{ data.totalVisits.toLocaleString() }}
            </span>
            <span class="text-sm text-muted-foreground">
              {{ data.totalVisits === 1 ? 'visit' : 'visits' }}
            </span>
          </div>

          <div class="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border/60">
            <div>
              <div class="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium mb-0.5">
                Last visit
              </div>
              <div class="text-sm font-medium truncate">
                {{ lastVisitLabel ?? '—' }}
              </div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium mb-0.5">
                Since
              </div>
              <div class="text-sm font-medium truncate">
                {{ firstVisitLabel ?? '—' }}
              </div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-wide text-muted-foreground/80 font-medium mb-0.5">
                Total time
              </div>
              <div class="text-sm font-medium truncate">
                {{ totalDurationLabel }}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Timeline: one card holding all days, with a continuous vertical
           line down the left side and a dot at each day. -->
      <Card>
        <CardContent class="p-4">
          <ol class="relative">
            <!-- Vertical timeline rail. Inset 5px from the dot's center so it
                 doesn't poke out at top/bottom. -->
            <span
              class="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-border"
              aria-hidden="true"
            />

            <li
              v-for="(day, dayIdx) in visitDays"
              :key="day.iso"
              :class="['relative pl-6', dayIdx > 0 ? 'mt-5' : '']"
            >
              <!-- Day marker dot, sits over the rail -->
              <span
                class="absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full bg-background border-2 border-primary"
                aria-hidden="true"
              />

              <h3 class="text-sm font-semibold leading-none mb-2">
                {{ dayHeading(day.date) }}
              </h3>

              <ul class="space-y-0.5">
                <li v-for="visit in day.visits" :key="visit.id">
                  <button
                    type="button"
                    class="w-full text-left flex items-baseline justify-between gap-3 -mx-2 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors"
                    @click="viewOnTimeline(visit)"
                  >
                    <span class="text-sm tabular-nums text-foreground/90">
                      {{ visitTimeLabel(visit) }}
                    </span>
                    <span class="text-xs text-muted-foreground tabular-nums shrink-0">
                      {{ visitDurationLabel(visit) }}
                    </span>
                  </button>
                </li>
              </ul>
            </li>
          </ol>
        </CardContent>
      </Card>
    </template>
  </component>
</template>
