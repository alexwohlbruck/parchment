<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import StarRating from './StarRating.vue'
import type {
  OwnReview,
  ReviewInput,
} from '@/services/place/mangrove-review.service'

const props = defineProps<{
  review: OwnReview | null
  defaultNickname?: string
  saving: boolean
}>()

const emit = defineEmits<{
  save: [input: Omit<ReviewInput, 'osmId'>]
  cancel: []
  delete: []
}>()

const { t } = useI18n()

// Mangrove rates 0–100; the form works in whole stars.
const stars = ref(props.review ? Math.round(props.review.rating / 20) : 0)
const opinion = ref(props.review?.opinion ?? '')
const nickname = ref(props.review?.nickname ?? props.defaultNickname ?? '')

const canSave = computed(() => stars.value > 0 && !props.saving)

function submit() {
  if (!canSave.value) return
  emit('save', {
    rating: stars.value * 20,
    opinion: opinion.value,
    nickname: nickname.value,
  })
}
</script>

<template>
  <form class="space-y-3" @submit.prevent="submit">
    <StarRating
      :rating="stars / 5"
      size="lg"
      editable
      @update:rating="stars = Math.round($event * 5)"
    />
    <Textarea
      v-model="opinion"
      :placeholder="t('place.reviews.form.opinion')"
      rows="4"
      maxlength="4000"
    />
    <Input
      v-model="nickname"
      :placeholder="t('place.reviews.form.nickname')"
      maxlength="80"
    />
    <p class="text-xs text-muted-foreground">
      {{ t('place.reviews.form.publicNotice') }}
    </p>
    <div class="flex items-center gap-2">
      <Button type="submit" size="sm" :disabled="!canSave">
        {{ review ? t('place.reviews.form.update') : t('place.reviews.form.post') }}
      </Button>
      <Button type="button" size="sm" variant="ghost" @click="emit('cancel')">
        {{ t('general.cancel') }}
      </Button>
      <Button
        v-if="review"
        type="button"
        size="sm"
        variant="ghost"
        class="ml-auto text-destructive hover:text-destructive"
        :disabled="saving"
        @click="emit('delete')"
      >
        {{ t('place.reviews.form.delete') }}
      </Button>
    </div>
  </form>
</template>
