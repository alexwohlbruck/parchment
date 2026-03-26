<script setup lang="ts">
import { cn } from '@/lib/utils'
import { TransitionExpand } from '@morev/vue-transitions'
import type { Place } from '@/types/place.types'

const { place } = defineProps<{
  place: Partial<Place>
}>()

const emit = defineEmits<{
  (e: 'imageLoaded'): void
  (e: 'imageError'): void
}>()
</script>

<template>
  <TransitionExpand>
    <div
      v-if="place.photos && place.photos.length > 0"
      :class="cn('w-full relative', $attrs.class ?? '')"
    >
      <div
        class="w-full overflow-x-auto touch-pan-x snap-x snap-mandatory flex gap-2 scrollbar-hidden pb-2 -mb-2"
      >
        <div
          v-for="(photo, index) in place.photos"
          :key="index"
          class="h-48 flex-none snap-center relative first:ml-3 last:mr-3 rounded-lg overflow-hidden shadow-md"
          :style="{ width: 'auto' }"
        >
          <div
            v-if="!photo.value.url"
            class="absolute inset-0 bg-muted/50 animate-pulse"
          >
            <div
              class="absolute inset-0 -translate-x-full animate-[shimmer_1s_infinite] bg-linear-to-r from-transparent via-white/10 to-transparent"
            />
          </div>
          <img
            :src="photo.value.url"
            :alt="place.name?.value || ''"
            class="h-full w-auto object-cover"
            @load="$emit('imageLoaded')"
            @error="$emit('imageError')"
          />
          <div
            v-if="!photo.value.url"
            class="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
          >
            <!-- TODO: i18n -->
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
