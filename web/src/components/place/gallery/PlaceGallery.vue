<script setup lang="ts">
import { TransitionExpand } from '@morev/vue-transitions'
import type { Place } from '@/types/place.types'

defineProps<{
  place: Place
}>()

const emit = defineEmits<{
  (e: 'imageLoaded'): void
  (e: 'imageError'): void
}>()
</script>

<template>
  <TransitionExpand>
    <div v-if="place.photos.length > 0" class="w-full relative">
      <div
        class="w-full overflow-x-auto snap-x snap-mandatory flex gap-2"
        style="scrollbar-width: none; -ms-overflow-style: none"
      >
        <div
          v-for="(photo, index) in place.photos"
          :key="index"
          class="h-48 flex-none snap-center relative first:ml-4 last:mr-4 rounded-lg overflow-hidden"
          :style="{ width: 'auto' }"
        >
          <div
            v-if="!photo.value.url"
            class="absolute inset-0 bg-muted/50 animate-pulse"
          >
            <div
              class="absolute inset-0 -translate-x-full animate-[shimmer_1s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent"
            />
          </div>
          <img
            :src="photo.value.url"
            :alt="place.name.value"
            class="h-full w-auto object-cover"
            @load="$emit('imageLoaded')"
            @error="$emit('imageError')"
          />
          <div
            v-if="!photo.value.url"
            class="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
          >
            Failed to load image
          </div>
        </div>
      </div>
    </div>
  </TransitionExpand>
</template>

<style scoped>
/* Hide scrollbar for Chrome, Safari and Opera */
.snap-x::-webkit-scrollbar {
  display: none;
}

/* Hide scrollbar for IE, Edge and Firefox */
.snap-x {
  -ms-overflow-style: none; /* IE and Edge */
  scrollbar-width: none; /* Firefox */
}

/* Active indicator dot */
.snap-x::-webkit-scrollbar-thumb {
  background-color: white;
}
</style>
