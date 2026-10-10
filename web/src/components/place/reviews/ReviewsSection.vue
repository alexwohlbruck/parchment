<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { SectionHeader } from '@/components/ui/section-header'
import { Button } from '@/components/ui/button'
import {
  MessageSquareQuoteIcon,
  PenLineIcon,
  PencilIcon,
  ThumbsUpIcon,
} from 'lucide-vue-next'
import PlaceSection from '../details/PlaceSection.vue'
import StarRating from './StarRating.vue'
import ReviewForm from './ReviewForm.vue'
import MangroveSignIn from './MangroveSignIn.vue'
import {
  SessionRequiredError,
  useMangroveReview,
} from '@/composables/place/useMangroveReview'
import { useMangroveStore } from '@/stores/mangrove.store'
import { toast } from '@/lib/toast'
import { SOURCE } from '@/lib/constants'
import {
  SignInCancelledError,
  type MangroveProvider,
  type ReviewInput,
} from '@/services/place/mangrove-review.service'
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

const {
  canReview,
  hasSession,
  ownReview,
  saving,
  signingIn,
  signIn,
  cancelSignIn,
  save,
  remove,
} = useMangroveReview(toRef(props, 'place'))
const mangroveStore = useMangroveStore()
const editing = ref(false)

/** The post, update or delete waiting on the person to sign in. */
const pendingAction = ref<(() => Promise<void>) | null>(null)

const reviews = computed(() =>
  (props.place.reviews ?? []).filter(
    (review) => review.value.id !== ownReview.value?.signature,
  ),
)
const hasReviews = computed(() => reviews.value.length > 0)
const isVisible = computed(
  () => hasReviews.value || canReview.value || !!ownReview.value,
)

const showAll = ref(false)
const visibleReviews = computed(() =>
  showAll.value || props.expanded
    ? reviews.value
    : reviews.value.slice(0, COLLAPSED_COUNT),
)
const hasMore = computed(
  () => !props.expanded && reviews.value.length > COLLAPSED_COUNT,
)

const rating = computed(() => props.place.ratings?.rating?.value ?? null)
const reviewCount = computed(() => props.place.ratings?.reviewCount?.value ?? 0)

const sourceNames = computed(
  () => new Map((props.place.sources ?? []).map((s) => [s.id, s.name])),
)
const mangroveUrl = computed(
  () => props.place.sources?.find((s) => s.id === SOURCE.MANGROVE)?.url,
)

function relativeDate(iso?: string): string | null {
  return iso ? dayjs(iso).fromNow() : null
}

async function run(action: () => Promise<void>) {
  if (!hasSession.value) {
    pendingAction.value = action
    return
  }
  try {
    await action()
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      pendingAction.value = action
      toast.info(t('place.reviews.signIn.expired'))
      return
    }
    toast.error(t('place.reviews.form.failed'), { cause: error })
  }
}

function onSave(input: Omit<ReviewInput, 'osmId'>) {
  const isEdit = !!ownReview.value
  return run(async () => {
    await save(input)
    editing.value = false
    toast.success(
      isEdit ? t('place.reviews.form.updated') : t('place.reviews.form.posted'),
    )
  })
}

function onDelete() {
  return run(async () => {
    await remove()
    editing.value = false
    toast.success(t('place.reviews.form.deleted'))
  })
}

async function onSignIn(provider: MangroveProvider) {
  try {
    await signIn(provider)
  } catch (error) {
    if (!(error instanceof SignInCancelledError)) {
      toast.error(t('place.reviews.signIn.failed'), { cause: error })
    }
    return
  }
  const action = pendingAction.value
  pendingAction.value = null
  if (action) await run(action)
}

function onCancelSignIn() {
  cancelSignIn()
  pendingAction.value = null
}

function stopEditing() {
  onCancelSignIn()
  editing.value = false
}
</script>

<template>
  <PlaceSection v-if="isVisible">
    <template #main>
      <!-- Heading -->
      <SectionHeader
        :icon="MessageSquareQuoteIcon"
        :title="t('place.reviews.title')"
      />

      <!-- Aggregate rating summary -->
      <div v-if="rating !== null" class="flex items-center gap-2">
        <span class="text-2xl font-semibold tabular-nums">
          {{ (rating * 5).toFixed(1) }}
        </span>
        <div class="flex flex-col gap-0.5">
          <StarRating :rating="rating" />
          <span v-if="reviewCount" class="text-xs text-muted-foreground">
            {{ t('place.reviews.ratings', { count: n(reviewCount) }, reviewCount) }}
          </span>
        </div>
      </div>

      <template v-if="editing">
        <ReviewForm
          :review="ownReview"
          :default-nickname="mangroveStore.session?.accountName"
          :saving="saving || !!pendingAction"
          @save="onSave"
          @delete="onDelete"
          @cancel="stopEditing"
        />
        <MangroveSignIn
          v-if="pendingAction"
          :waiting="signingIn"
          @sign-in="onSignIn"
          @cancel="onCancelSignIn"
        />
      </template>
      <div v-else-if="ownReview" class="space-y-1 rounded-lg bg-muted/50 p-3">
        <div class="flex items-center gap-2 text-xs">
          <StarRating :rating="ownReview.rating / 100" size="sm" />
          <span class="font-medium">{{ t('place.reviews.yours') }}</span>
          <Button
            size="sm"
            variant="ghost"
            class="ml-auto h-7 gap-1.5 px-2 text-xs"
            @click="editing = true"
          >
            <PencilIcon class="size-3" />
            {{ t('place.reviews.form.edit') }}
          </Button>
        </div>
        <p v-if="ownReview.opinion" class="text-sm leading-relaxed">
          {{ ownReview.opinion }}
        </p>
      </div>
      <Button
        v-else-if="canReview"
        size="sm"
        variant="outline"
        class="w-fit gap-1.5"
        @click="editing = true"
      >
        <PenLineIcon class="size-3.5" />
        {{ t('place.reviews.write') }}
      </Button>

      <p v-if="!hasReviews && !ownReview" class="text-sm text-muted-foreground">
        {{ t('place.reviews.empty') }}
      </p>

      <!-- Review list -->
      <ul v-if="hasReviews" class="space-y-3">
        <li
          v-for="review in visibleReviews"
          :key="review.value.id"
          class="border-t pt-3 first:border-t-0 first:pt-0"
        >
          <div
            v-if="review.value.rating !== undefined || review.value.authorName"
            class="mb-1 flex items-center gap-2 text-xs"
          >
            <StarRating
              v-if="review.value.rating !== undefined"
              :rating="review.value.rating"
              size="sm"
            />
            <span v-if="review.value.authorName" class="font-medium">
              {{ review.value.authorName }}
            </span>
          </div>
          <p class="text-sm leading-relaxed text-foreground">
            {{ review.value.text }}
          </p>
          <div
            class="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span v-if="sourceNames.get(review.sourceId)">
              {{ sourceNames.get(review.sourceId) }}
            </span>
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

      <a
        v-if="mangroveUrl && !canReview"
        :href="mangroveUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        <PenLineIcon class="size-3.5" />
        {{ t('place.reviews.writeOnMangrove') }}
      </a>
    </template>
  </PlaceSection>
</template>
