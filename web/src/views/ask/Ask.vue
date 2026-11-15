<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpIcon, MessageCircleQuestionIcon } from 'lucide-vue-next'
import { AppRoute } from '@/router'
import { useAskStore } from '@/stores/ask.store'
import { useSearchStore } from '@/stores/search.store'
import { useAskService } from '@/services/ask/ask.service'
import { useOpenRouterConnect } from '@/services/ask/openrouter-connect.service'
import { isTauri } from '@/lib/api'
import { useMapService } from '@/services/map/map.service'
import { usePlaceService } from '@/services/place/place.service'
import { getPlaceRoute } from '@/lib/place/place-route'
import { boundsOfPoints } from '@/lib/geo/map-bounds'
import { useAreaLayer } from '@/composables/map/useAreaLayer'
import {
  ASK_REACH_FILL_LAYER_ID,
  ASK_REACH_LINE_LAYER_ID,
  ASK_REACH_SOURCE_ID,
} from '@/constants/layers'
import { formatResetDay } from '@/lib/ask/ask-quota'
import AskExchange from '@/components/ask/AskExchange.vue'
import UpgradeBanner from '@/components/subscription/UpgradeBanner.vue'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { Place } from '@/types/place.types'

const props = defineProps<{
  question?: string
  placeId?: string
  placeName?: string
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

const followUp = ref('')
const loadingAccess = ref(!askStore.access)
const access = computed(() => askStore.access)

async function start(question: string | undefined) {
  const text = question?.trim()
  if (!text || text === askStore.current?.question) return
  const result = await askService
    .loadAccess({ fresh: !askStore.access?.allowed })
    .catch(() => null)
  loadingAccess.value = false
  if (result?.allowed) askService.ask(text)
}

function connectOpenRouter() {
  openRouterConnect.start(route.fullPath)
}

function retry() {
  const question = askStore.current?.question
  if (question) askService.ask(question, { followUp: askStore.exchanges.length > 1 })
}

const firstAboutPlace = computed(() => !!props.placeId && !askStore.exchanges.length)

function submitFollowUp() {
  const text = followUp.value.trim()
  if (!text || askStore.isRunning) return
  followUp.value = ''
  if (firstAboutPlace.value) askService.ask(text, { placeId: props.placeId })
  else askService.ask(text, { followUp: true })
}

function openPlace(place: Place) {
  setPartialPlace(place)
  router.push(getPlaceRoute(place.id))
}

function onMarkerClick(event: Event) {
  const { place } = (event as CustomEvent).detail
  if (place?.id) openPlace(place)
}

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
  const bounds = boundsOfPoints(
    places.flatMap(place => place.geometry?.value?.center ?? []),
  )
  if (bounds) mapService.fitBounds(bounds, { maxZoom: 16 })
})

watch(() => props.question, start)

onMounted(async () => {
  document.addEventListener('search-result-click', onMarkerClick)
  if (props.placeId && !props.question) {
    askStore.reset()
    await askService.loadAccess({ fresh: !askStore.access?.allowed }).catch(() => null)
    loadingAccess.value = false
  } else if (props.question === askStore.current?.question) {
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
      <div v-else class="flex flex-col gap-3">
        <EmptyState
          v-if="access.reason === 'quota-exceeded'"
          :icon="MessageCircleQuestionIcon"
          :title="t('ask.quota.title')"
          :description="t('ask.quota.description', { date: formatResetDay(access.resetsAt, locale) })"
          variant="inline"
        />
        <UpgradeBanner
          v-else
          required-tier="premium"
          :title="t('ask.locked.title')"
          :description="t('ask.locked.description')"
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

    <template v-else>
      <AskExchange
        v-for="(exchange, index) in askStore.exchanges"
        :key="index"
        :exchange="exchange"
        :class="index < askStore.exchanges.length - 1 && 'opacity-60'"
        @retry="retry"
        @place-hover="searchStore.setHoveredPlace($event)"
        @place-leave="searchStore.setHoveredPlace(null)"
      />

      <h2
        v-if="firstAboutPlace && placeName"
        class="text-lg font-bold text-foreground tracking-tight leading-tight"
      >
        {{ t('ask.aboutPlace.title', { name: placeName }) }}
      </h2>

      <form
        v-if="askStore.exchanges.length || firstAboutPlace"
        class="sticky bottom-4 flex items-center gap-2"
        :class="!firstAboutPlace && 'mt-auto'"
        @submit.prevent="submitFollowUp"
      >
        <Input
          v-model="followUp"
          :autofocus="firstAboutPlace"
          :placeholder="firstAboutPlace ? t('ask.aboutPlace.placeholder') : t('ask.followUp')"
          :disabled="askStore.isRunning"
          class="flex-1 bg-background/85 backdrop-blur-xl"
        />
        <Button
          type="submit"
          size="icon"
          :disabled="askStore.isRunning || !followUp.trim()"
          :aria-label="t('ask.followUp')"
        >
          <ArrowUpIcon class="size-4" />
        </Button>
      </form>
    </template>
  </div>
</template>
