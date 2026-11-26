<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { MessageCircleQuestionIcon, PowerOffIcon } from 'lucide-vue-next'
import { AppRoute } from '@/router'
import { useAskStore } from '@/stores/ask.store'
import { useSearchStore } from '@/stores/search.store'
import { useAskService } from '@/services/ask/ask.service'
import { useAuthService } from '@/services/auth.service'
import { PermissionId } from '@/types/auth.types'
import { useAskHistoryService } from '@/services/ask/ask-history.service'
import { useAskPreferencesStore } from '@/stores/preferences/ask-preferences.store'
import { useOpenRouterConnect } from '@/services/ask/openrouter-connect.service'
import { isTauri } from '@/lib/api'
import { useMapService } from '@/services/map/map.service'
import { usePlaceService } from '@/services/place/place.service'
import { getPlaceRoute } from '@/lib/place/place-route'
import { boundsOfPoints } from '@/lib/geo/map-bounds'
import { useAreaLayer } from '@/composables/map/useAreaLayer'
import { useAskContext } from '@/composables/ask/useAskContext'
import { useAskTripPreview } from '@/composables/ask/useAskTripPreview'
import {
  ASK_REACH_FILL_LAYER_ID,
  ASK_REACH_LINE_LAYER_ID,
  ASK_REACH_SOURCE_ID,
} from '@/constants/layers'
import { formatResetDay } from '@/lib/ask/ask-quota'
import AskExchange from '@/components/ask/AskExchange.vue'
import AskComposer from '@/components/ask/AskComposer.vue'
import AskThreadList from '@/components/ask/AskThreadList.vue'
import UpgradeBanner from '@/components/subscription/UpgradeBanner.vue'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { Place } from '@/types/place.types'
import { ASK_SKILLS, type AskPoint } from '@/types/ask.types'

const props = defineProps<{
  question?: string
  skill?: string
  placeId?: string
  placeName?: string
  lat?: string
  lng?: string
  thread?: string
}>()

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const openRouterConnect = useOpenRouterConnect()
const askStore = useAskStore()
const searchStore = useSearchStore()
const askService = useAskService()
const mapService = useMapService()
const { setPartialPlace } = usePlaceService()
const askContext = useAskContext()
const tripPreview = useAskTripPreview()
const askHistory = useAskHistoryService()
const askPreferences = useAskPreferencesStore()

const authService = useAuthService()
const upgradeTier = computed(() => {
  if (authService.hasPermission(PermissionId.PREMIUM_ASK)) return null
  return authService.hasPermission(PermissionId.ASK_BASIC) ? 'premium' : 'basic'
})

const point = computed<AskPoint | undefined>(() => {
  if (props.placeId || props.lat === undefined || props.lng === undefined) return undefined
  const lat = Number(props.lat)
  const lng = Number(props.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined
  return { lat, lng, name: props.placeName }
})
const hasSubject = computed(() => !!props.placeId || !!point.value)

const skill = computed(() => ASK_SKILLS.find(id => id === props.skill))

const showHistory = computed(() => !props.question && !hasSubject.value && !props.thread)

watch(
  () => askStore.current?.trip,
  trip => {
    if (trip) tripPreview.preview(askStore.exchanges.length - 1, trip)
  },
)

const TRIP_ROUTES: unknown[] = [AppRoute.DIRECTIONS, AppRoute.TRIP]

onBeforeRouteLeave(to => {
  if (!TRIP_ROUTES.includes(to.name)) tripPreview.clear()
})

const followUp = ref('')
const newQuestion = ref('')

function askNew() {
  const text = newQuestion.value.trim()
  if (!text) return
  newQuestion.value = ''
  router.push({ name: AppRoute.ASK, query: { q: text } })
}
const loadingAccess = ref(!askStore.access)
const access = computed(() => askStore.access)

async function start(question: string | undefined) {
  if (props.thread) return
  const text = question?.trim()
  if (!text || isCurrent(text)) return
  const result = await askService
    .loadAccess({ fresh: !askStore.access?.allowed })
    .catch(() => null)
  loadingAccess.value = false
  if (result?.allowed) askService.ask(text, askContext(), { skill: skill.value })
}

function isCurrent(question: string | undefined) {
  return question === askStore.current?.question && skill.value === askStore.current?.skill
}

async function loadAccess() {
  await askService.loadAccess({ fresh: !askStore.access?.allowed }).catch(() => null)
  loadingAccess.value = false
}

async function openThread(id: string | undefined) {
  if (!id || id === askStore.threadId) return
  askService.cancel()
  await Promise.all([askHistory.load(), loadAccess()])
  const thread = askHistory.find(id)
  if (thread) {
    askStore.restore(thread)
    return
  }
  const question = props.question
  await router.replace({ name: AppRoute.ASK, query: question ? { q: question, skill: skill.value } : {} })
  await nextTick()
  start(question)
}

async function showThreads() {
  askService.cancel()
  askStore.reset()
  tripPreview.clear()
  await Promise.all([askHistory.load(), loadAccess()])
}

function openSettings() {
  router.push({ name: AppRoute.ASK_SETTINGS })
}

function connectOpenRouter() {
  openRouterConnect.start(route.fullPath)
}

function retry() {
  const current = askStore.current
  if (current) {
    askService.ask(current.question, askContext(), { followUp: askStore.exchanges.length > 1, skill: current.skill })
  }
}

const firstAboutPlace = computed(() => hasSubject.value && !askStore.exchanges.length)

function askFollowUp(question: string) {
  if (!askStore.isRunning) askService.ask(question, askContext(), { followUp: true })
}

function submitFollowUp() {
  const text = followUp.value.trim()
  if (!text || askStore.isRunning) return
  followUp.value = ''
  if (firstAboutPlace.value) askService.ask(text, askContext(), { placeId: props.placeId, point: point.value })
  else askService.ask(text, askContext(), { followUp: true })
}

function openPlace(place: Place) {
  setPartialPlace(place)
  router.push(getPlaceRoute(place.id))
}

function onMarkerClick(event: Event) {
  const { place } = (event as CustomEvent).detail
  if (place?.id) openPlace(place)
}

watch(
  () => askStore.current?.status,
  (status, before) => {
    const exchange = askStore.current
    if (status !== 'done' || before !== 'running' || exchange?.places.length !== 1) return
    const lookedUp = exchange.steps.some(step => step.tool === 'find_place_on_web' && step.status === 'done')
    if (lookedUp) openPlace(exchange.places[0].place)
  },
)

const citedPlaces = computed(() =>
  askStore.current?.places.map(({ place }) => place) ?? [],
)

const REACH_OPACITY = 0.12

useAreaLayer(
  { source: ASK_REACH_SOURCE_ID, fill: ASK_REACH_FILL_LAYER_ID, line: ASK_REACH_LINE_LAYER_ID },
  () => !!askStore.current?.reach,
  () => ({
    type: 'FeatureCollection',
    features: askStore.current?.reach
      ? [{ type: 'Feature', properties: { opacity: REACH_OPACITY }, geometry: askStore.current.reach }]
      : [],
  }),
)

watch(citedPlaces, places => {
  searchStore.setSearchResults(places)
  const reach = askStore.current?.reach
  const reachCorners = reach
    ? (reach.type === 'Polygon' ? [reach.coordinates] : reach.coordinates)
        .flatMap(polygon => polygon[0])
        .map(([lng, lat]) => ({ lat, lng }))
    : []
  const bounds = boundsOfPoints([
    ...places.flatMap(place => place.geometry?.value?.center ?? []),
    ...reachCorners,
  ])
  if (bounds) mapService.fitBounds(bounds, { maxZoom: 16 })
})

watch(() => props.question, start)
watch(() => props.thread, openThread)
watch(showHistory, show => {
  if (show) showThreads()
})

onMounted(async () => {
  document.addEventListener('search-result-click', onMarkerClick)
  if (props.thread) {
    openThread(props.thread)
  } else if (showHistory.value) {
    showThreads()
  } else if (hasSubject.value && !props.question) {
    askStore.reset()
    await askService.loadAccess({ fresh: !askStore.access?.allowed }).catch(() => null)
    loadingAccess.value = false
  } else if (isCurrent(props.question)) {
    searchStore.setSearchResults(citedPlaces.value)
    loadingAccess.value = false
  } else {
    start(props.question)
  }
})

onUnmounted(() => {
  document.removeEventListener('search-result-click', onMarkerClick)
  askService.cancel()
  searchStore.clearSearchResults()
})
</script>

<template>
  <div class="min-h-full flex flex-col gap-6 pt-4 px-4 pb-4">
    <div v-if="loadingAccess" class="py-12 flex justify-center">
      <Spinner size="icon" class="text-muted-foreground" />
    </div>

    <template v-else-if="access && !access.allowed">
      <EmptyState
        v-if="access.reason === 'not-configured'"
        :icon="MessageCircleQuestionIcon"
        :title="t('ask.notConfigured')"
      />
      <EmptyState
        v-else-if="access.reason === 'turned-off'"
        :icon="PowerOffIcon"
        :title="t('ask.off.title')"
      >
        <Button variant="outline" @click="openSettings">{{ t('ask.off.action') }}</Button>
      </EmptyState>
      <div v-else class="flex flex-col gap-3">
        <EmptyState
          v-if="access.reason === 'quota-exceeded'"
          :icon="MessageCircleQuestionIcon"
          :title="t('ask.quota.title')"
          :description="t('ask.quota.description', { date: formatResetDay(access.resetsAt, locale) })"
          variant="inline"
        />
        <UpgradeBanner
          v-if="upgradeTier"
          :required-tier="upgradeTier"
          :description="access.reason === 'quota-exceeded' ? t('ask.quota.upgrade') : t('ask.locked.description')"
        />
        <div class="flex items-center gap-2">
          <Button v-if="!isTauri" @click="connectOpenRouter">
            {{ t('ask.connect.action') }}
          </Button>
          <Button
            variant="outline"
            @click="router.push({ name: AppRoute.INTEGRATIONS })"
          >
            {{ t('ask.locked.addKey') }}
          </Button>
        </div>
      </div>
    </template>

    <template v-else-if="showHistory">
      <AskComposer
        v-model="newQuestion"
        autofocus
        :placeholder="t('ask.placeholder')"
        @submit="askNew"
      />
      <AskThreadList
        :threads="askStore.threads"
        :saving="askPreferences.preferences.saveHistory"
        @open="router.push({ name: AppRoute.ASK, query: { thread: $event } })"
        @remove="askHistory.remove"
        @settings="openSettings"
      />
    </template>

    <template v-else>
      <AskExchange
        v-for="(exchange, index) in askStore.exchanges"
        :key="index"
        :exchange="exchange"
        :latest="index === askStore.exchanges.length - 1"
        :class="index < askStore.exchanges.length - 1 && 'opacity-60'"
        @retry="retry"
        @place-open="openPlace"
        @follow-up="askFollowUp"
        @place-hover="searchStore.setHoveredPlace($event)"
        @place-leave="searchStore.setHoveredPlace(null)"
      />

      <h2
        v-if="firstAboutPlace && placeName"
        class="text-lg font-bold text-foreground tracking-tight leading-tight"
      >
        {{ t('ask.aboutPlace.title', { name: placeName }) }}
      </h2>

      <AskComposer
        v-if="askStore.exchanges.length || firstAboutPlace"
        v-model="followUp"
        class="sticky bottom-4"
        :class="!firstAboutPlace && 'mt-auto'"
        :autofocus="firstAboutPlace"
        :placeholder="firstAboutPlace ? t('ask.aboutPlace.placeholder') : t('ask.followUp')"
        :disabled="askStore.isRunning"
        @submit="submitFollowUp"
      />
    </template>
  </div>
</template>
