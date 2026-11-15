<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { PlaceCard } from '@/components/place/card'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import ErrorMessage from '@/components/ErrorMessage.vue'
import { EmptyState } from '@/components/ui/empty-state'
import { ArrowRightIcon, MapPinOffIcon } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { createSearchResultsRoute } from '@/lib/search/search-result'
import { intentFilters } from '@/lib/search/query-intent'
import AskSteps from './AskSteps.vue'
import type { AskExchange } from '@/stores/ask.store'

const props = defineProps<{
  exchange: AskExchange
}>()

const emit = defineEmits<{
  retry: []
  'place-hover': [placeId: string]
  'place-leave': []
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

    <AskSteps :steps="exchange.steps" :running="exchange.status === 'running'" />

    <ErrorMessage
      v-if="exchange.status === 'error'"
      type="error"
      :title="t('ask.error')"
      :message="exchange.error"
      :button-text="t('ask.retry')"
      @action="emit('retry')"
    />

    <p v-if="exchange.text" class="text-sm text-foreground leading-relaxed">
      {{ exchange.text }}
    </p>

    <EmptyState
      v-if="exchange.status === 'done' && !exchange.places.length && !exchange.text"
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
  </section>
</template>
