<script setup lang="ts">
import { computed, ref } from 'vue'
import { StarIcon, XIcon } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import type { Place } from '@/types/place.types'
import { getLogoPhoto } from '@/types/place.types'

const props = defineProps<{
  place: Place
}>()

const placeType = computed(() => props.place?.placeType.value || 'Place')
const rating = computed(() => props.place?.ratings?.rating?.value || null)
const reviewCount = computed(
  () => props.place?.ratings?.reviewCount?.value || 0,
)
const brandLogo = computed(() => getLogoPhoto(props.place)?.url)
const description = computed(() => props.place?.description?.value || null)

const logoLoading = ref(false)
const logoError = ref(false)
const brandLogoLoaded = ref(false)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'logoLoaded'): void
  (e: 'logoError'): void
}>()
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-start justify-between gap-2">
      <!-- Brand Logo -->
      <div
        v-if="logoLoading || brandLogo || logoError"
        class="size-12 rounded-lg overflow-hidden border border-border shadow-sm shrink-0 mr-2"
      >
        <div
          v-if="logoLoading"
          class="w-full h-full bg-muted/50 animate-pulse relative overflow-hidden"
        >
          <div
            class="absolute inset-0 -translate-x-full animate-[shimmer_1s_infinite] bg-linear-to-r from-transparent via-white/10 to-transparent"
          />
        </div>
        <div v-if="brandLogo" class="w-full h-full">
          <transition
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            enter-active-class="transition-opacity duration-200"
          >
            <img
              v-show="brandLogoLoaded"
              :src="brandLogo"
              :alt="place.name.value + ' logo'"
              class="w-full h-full object-contain bg-white"
              @load="$emit('logoLoaded')"
              @error="$emit('logoError')"
            />
          </transition>
        </div>
        <div
          v-if="logoError"
          class="w-full h-full flex items-center justify-center bg-muted"
        />
      </div>

      <div class="flex-1">
        <h1 class="text-2xl font-semibold line-clamp-2">
          {{ place.name.value }}
        </h1>
        <div class="text-sm text-muted-foreground">
          {{ placeType }}
        </div>
        <div v-if="rating !== null" class="flex items-center gap-1 mt-1">
          <div class="flex">
            <StarIcon
              v-for="i in Math.floor(rating * 5)"
              :key="i"
              class="w-3 h-3 fill-current text-yellow-400"
            />
            <StarIcon
              v-for="i in 5 - Math.floor(rating * 5)"
              :key="i + 5"
              class="w-3 h-3 text-muted-foreground"
            />
          </div>
          <span class="text-sm">
            {{ (rating * 5).toFixed(1) }}
            <span class="text-muted-foreground">({{ reviewCount }})</span>
          </span>
        </div>
      </div>
      <Button variant="ghost" size="icon" @click="$emit('close')">
        <XIcon class="size-4" />
      </Button>
    </div>

    <!-- Description Section -->
    <div v-if="description">
      <p class="text-sm text-muted-foreground leading-relaxed">
        {{ description }}
      </p>
    </div>
  </div>
</template>
