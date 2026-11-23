<script setup lang="ts">
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import type { AttributedValue, Place, Review } from '@/types/place.types'

dayjs.extend(relativeTime)

const props = defineProps<{
  place: Place
  reviews: AttributedValue<Review>[]
}>()

function attribution({ value, sourceId }: AttributedValue<Review>): string {
  const source = props.place.sources?.find((s) => s.id === sourceId)?.name ?? sourceId
  return [value.authorName, source, value.createdAt && dayjs(value.createdAt).fromNow()]
    .filter(Boolean)
    .join(' · ')
}
</script>

<template>
  <ul class="flex flex-col gap-2 px-3 pb-2.5">
    <li
      v-for="review in reviews"
      :key="review.value.id"
      class="border-l-2 border-border pl-2.5"
    >
      <component
        :is="review.value.url ? 'a' : 'p'"
        :href="review.value.url"
        target="_blank"
        rel="noopener noreferrer"
        class="line-clamp-2 text-sm text-muted-foreground"
        :class="{ 'hover:text-foreground': review.value.url }"
      >
        “{{ review.value.text }}”
      </component>
      <p class="mt-0.5 text-xs text-muted-foreground/80">{{ attribution(review) }}</p>
    </li>
  </ul>
</template>
