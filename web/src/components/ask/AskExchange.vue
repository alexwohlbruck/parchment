<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { PlaceCard } from '@/components/place/card'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import ErrorMessage from '@/components/ErrorMessage.vue'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowRightIcon, CornerUpRightIcon, MapPinOffIcon } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { createSearchResultsRoute } from '@/lib/search/search-result'
import { intentFilters } from '@/lib/search/query-intent'
import AskTrace from './AskTrace.vue'
import AskAnswer from './AskAnswer.vue'
import AskFollowUps from './AskFollowUps.vue'
import AskTripCard from './AskTripCard.vue'
import DirectionsLoading from '@/components/directions/DirectionsLoading.vue'
import { AppRoute } from '@/router'
import type { AskExchange } from '@/stores/ask.store'
import type { Place } from '@/types/place.types'

const props = defineProps<{
  exchange: AskExchange
  /** Only the latest exchange offers follow-ups. */
  latest?: boolean
}>()

const emit = defineEmits<{
  retry: []
  'place-hover': [placeId: string]
  'place-leave': []
  'place-open': [place: Place]
  'follow-up': [question: string]
}>()

const { t } = useI18n()
const router = useRouter()

const browseRoute = computed(() => {
  const intent = props.exchange.browse
  if (!intent?.category) return null
  return createSearchResultsRoute({
    categoryId: intent.category.id,
    categoryName: intent.category.name,
    filters: intentFilters(intent),
  })
})
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-bold text-foreground tracking-tight leading-tight">
      {{ exchange.question }}
    </h2>

    <AskTrace
      :steps="exchange.steps"
      :running="exchange.status === 'running'"
      :started-at="exchange.startedAt"
      :finished-at="exchange.finishedAt"
    />

    <ErrorMessage
      v-if="exchange.status === 'error'"
      type="error"
      :title="t('ask.error')"
      :message="exchange.error"
      :button-text="t('ask.retry')"
      @action="emit('retry')"
    />

    <AskAnswer
      v-if="exchange.text"
      :text="exchange.text"
      :places="exchange.places"
      @place-open="emit('place-open', $event)"
      @place-hover="emit('place-hover', $event)"
      @place-leave="emit('place-leave')"
    />

    <template v-if="exchange.trip">
      <AskTripCard v-if="exchange.plan" :plan="exchange.plan" :stops="exchange.trip.stops" />
      <div v-else-if="exchange.plan === undefined" :class="ITEM_ROW_SURFACES.row" class="py-6">
        <DirectionsLoading />
      </div>
      <Button v-else class="self-start" @click="router.push({ name: AppRoute.DIRECTIONS })">
        <CornerUpRightIcon class="size-4" />
        {{ exchange.trip.to.name ? t('ask.trip.directionsTo', { name: exchange.trip.to.name }) : t('ask.trip.directions') }}
      </Button>
    </template>

    <EmptyState
      v-if="exchange.status === 'done' && !exchange.places.length && !exchange.text && !exchange.trip"
      :icon="MapPinOffIcon"
      :title="t('ask.empty.title')"
      :description="t('ask.empty.description')"
      variant="inline"
    />

    <ol v-if="exchange.places.length" class="flex flex-col gap-2">
      <li
        v-for="{ place, reason } in exchange.places"
        :key="place.id"
        :class="ITEM_ROW_SURFACES.row"
        @mouseenter="emit('place-hover', place.id)"
        @mouseleave="emit('place-leave')"
      >
        <PlaceCard :place="place" variant="plain" size="sm" density="rich" />
        <p v-if="reason" class="px-3 pb-2.5 text-sm text-foreground">
          {{ reason }}
        </p>
      </li>
    </ol>

    <Button
      v-if="exchange.status === 'done' && browseRoute"
      variant="ghost"
      size="sm"
      class="self-start -ml-2 text-muted-foreground"
      @click="router.push(browseRoute)"
    >
      {{ t('ask.seeAll', { name: exchange.browse!.category!.name }) }}
      <ArrowRightIcon class="size-4" />
    </Button>

    <AskFollowUps
      v-if="latest && exchange.status === 'done' && exchange.followUps?.length"
      :questions="exchange.followUps"
      @ask="emit('follow-up', $event)"
    />
  </section>
</template>
