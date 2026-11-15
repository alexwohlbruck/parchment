<script setup lang="ts">
import { computed } from 'vue'
import { MapPinIcon } from 'lucide-vue-next'
import { splitMentions } from '@/lib/ask/mentions'
import type { AskCitation } from '@/types/ask.types'
import type { Place } from '@/types/place.types'

const props = defineProps<{
  text: string
  places: AskCitation[]
  animate?: boolean
}>()

const emit = defineEmits<{
  'place-open': [place: Place]
  'place-hover': [placeId: string]
  'place-leave': []
}>()

const WORD_DELAY_MS = 14

interface Piece {
  text: string
  delay: number
  place?: Place
}

/** Words and place chips in reading order, each with when it fades in. */
const pieces = computed<Piece[]>(() => {
  const names = props.places.map(({ place }) => place.name?.value ?? place.placeType?.value ?? '')
  let index = 0
  return splitMentions(props.text, names).flatMap(part =>
    'mention' in part
      ? [{ place: props.places[part.mention].place, text: part.text, delay: index++ * WORD_DELAY_MS }]
      : part.text.split(/(\s+)/).filter(Boolean).map(word => ({ text: word, delay: index++ * WORD_DELAY_MS })),
  )
})
</script>

<template>
  <p class="text-sm leading-relaxed text-foreground">
    <template v-for="(piece, i) in pieces" :key="i">
      <button
        v-if="piece.place"
        type="button"
        class="mx-px inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/60 px-1.5 align-[1px] text-[0.92em] font-medium leading-snug hover:bg-muted transition-colors"
        :class="animate && 'animate-[fade-in_250ms_both]'"
        :style="animate ? { animationDelay: `${piece.delay}ms` } : undefined"
        @click="emit('place-open', piece.place)"
        @mouseenter="emit('place-hover', piece.place.id)"
        @mouseleave="emit('place-leave')"
      >
        <MapPinIcon class="size-3 text-muted-foreground" />{{ piece.text }}
      </button>
      <span
        v-else
        :class="animate && 'animate-[fade-in_250ms_both]'"
        :style="animate ? { animationDelay: `${piece.delay}ms` } : undefined"
      >{{ piece.text }}</span>
    </template>
  </p>
</template>
