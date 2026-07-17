<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { MessageSquareQuoteIcon, StarIcon, ThumbsUpIcon } from 'lucide-vue-next'
import PlaceSection from '../details/PlaceSection.vue'
import type { Place } from '@/types/place.types'

dayjs.extend(relativeTime)

const props = withDefaults(
  defineProps<{
    place: Partial<Place>
    /** Render every review without the collapse (e.g. inside the Reviews tab). */
    expanded?: boolean
  }>(),
  { expanded: false },
)
const { t, n } = useI18n()

const COLLAPSED_COUNT = 3

const reviews = computed(() => props.place.reviews ?? [])
const hasReviews = computed(() => reviews.value.length > 0)

const showAll = ref(false)
const visibleReviews = computed(() =>
  showAll.value || props.expanded
    ? reviews.value
    : reviews.value.slice(0, COLLAPSED_COUNT),
)
const hasMore = computed(
  () => !props.expanded && reviews.value.length > COLLAPSED_COUNT,
)

// Aggregate rating (0–1 normalized on the model → 0–5 for display).
const ratingOutOfFive = computed(() => {
  const r = props.place.ratings?.rating?.value
  return typeof r === 'number' ? r * 5 : null
})
const reviewCount = computed(() => props.place.ratings?.reviewCount?.value ?? 0)
const filledStars = computed(() =>
  ratingOutOfFive.value === null ? 0 : Math.round(ratingOutOfFive.value),
)

function relativeDate(iso?: string): string | null {
  return iso ? dayjs(iso).fromNow() : null
}
</script>

<template>
  <PlaceSection v-if="hasReviews">
    <template #main>
      <!-- Heading -->
      <div class="flex items-center gap-2">
        <MessageSquareQuoteIcon class="size-4 text-muted-foreground" />
        <h3 class="text-sm font-semibold text-muted-foreground">
          {{ t('place.reviews.title') }}
        </h3>
      </div>

      <!-- Aggregate rating summary -->
      <div v-if="ratingOutOfFive !== null" class="flex items-center gap-2">
        <span class="text-2xl font-semibold tabular-nums">
          {{ ratingOutOfFive.toFixed(1) }}
        </span>
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center gap-0.5">
            <StarIcon
              v-for="i in 5"
              :key="i"
              class="size-3.5"
              :class="
                i <= filledStars
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-muted-foreground/30'
              "
            />
          </div>
          <span v-if="reviewCount" class="text-xs text-muted-foreground">
            {{ t('place.reviews.ratings', { count: n(reviewCount) }, reviewCount) }}
          </span>
        </div>
      </div>

      <!-- Review list -->
      <ul class="space-y-3">
        <li
          v-for="review in visibleReviews"
          :key="review.value.id"
          class="border-t pt-3 first:border-t-0 first:pt-0"
        >
          <p class="text-sm leading-relaxed text-foreground">
            {{ review.value.text }}
          </p>
          <div
            class="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span v-if="relativeDate(review.value.createdAt)">
              {{ relativeDate(review.value.createdAt) }}
            </span>
            <span
              v-if="review.value.helpfulCount"
              class="flex items-center gap-1"
            >
              <ThumbsUpIcon class="size-3" />
              {{ n(review.value.helpfulCount) }}
            </span>
          </div>
        </li>
      </ul>

      <!-- Show more / less -->
      <button
        v-if="hasMore"
        type="button"
        class="text-xs font-medium text-primary hover:underline"
        @click="showAll = !showAll"
      >
        {{
          showAll
            ? t('place.reviews.showLess')
            : t('place.reviews.showAll', { count: n(reviews.length) })
        }}
      </button>
    </template>
  </PlaceSection>
</template>
