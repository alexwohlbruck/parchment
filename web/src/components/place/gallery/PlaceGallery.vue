<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { TransitionExpand } from '@morev/vue-transitions'
import { ImageLightbox, cacheImageSize, type LightboxImage } from '@/components/ui/lightbox'
import type { Place } from '@/types/place.types'

const { place } = defineProps<{
  place: Partial<Place>
}>()

const emit = defineEmits<{
  (e: 'imageLoaded'): void
  (e: 'imageError'): void
}>()

const { t } = useI18n()

// The brand logo (isLogo) belongs in the header, not the gallery — exclude it.
const galleryPhotos = computed(() =>
  (place.photos ?? []).filter(p => !p.value?.isLogo),
)

const lightboxImages = computed<LightboxImage[]>(() =>
  galleryPhotos.value.map(photo => ({
    src: photo.value.url,
    alt: photo.value.alt || place.name?.value || '',
    width: photo.value.width,
    height: photo.value.height,
  })),
)

/** Index of the photo open in the lightbox; null when it is closed. */
const openIndex = ref<number | null>(null)

/**
 * The thumbnails, in order, so the lightbox can zoom a photo out of the one it
 * came from. Templates fill this by index, which can leave holes when photos
 * change, hence the explicit reset.
 */
const thumbs = ref<(HTMLImageElement | null)[]>([])
const thumbFor = (index: number) => thumbs.value[index]

const failed = ref(new Set<number>())

watch(galleryPhotos, () => {
  thumbs.value = []
  failed.value = new Set()
  openIndex.value = null
})

function onLoad(index: number, event: Event) {
  const img = event.target as HTMLImageElement
  // The strip and the lightbox share a URL, so the thumbnail's natural size is
  // the full image's size — the lightbox gets it without a second request.
  cacheImageSize(img.currentSrc || img.src, {
    width: img.naturalWidth,
    height: img.naturalHeight,
  })
  failed.value.delete(index)
  emit('imageLoaded')
}

function onError(index: number) {
  failed.value = new Set(failed.value).add(index)
  emit('imageError')
}
</script>

<template>
  <TransitionExpand>
    <div
      v-if="galleryPhotos.length > 0"
      :class="cn('w-full relative', $attrs.class ?? '')"
    >
      <div
        class="w-full overflow-x-auto touch-pan-x snap-x snap-mandatory flex gap-2 scrollbar-hidden pb-2 -mb-2"
      >
        <button
          v-for="(photo, index) in galleryPhotos"
          :key="photo.value.url || index"
          type="button"
          class="h-48 flex-none snap-center relative first:ml-3 last:mr-3 rounded-lg overflow-hidden shadow-md cursor-zoom-in transition-[transform,opacity] duration-200 ease-out active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          :aria-label="t('place.gallery.viewPhoto', { n: index + 1, total: galleryPhotos.length })"
          @click="openIndex = index"
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
            v-else
            :ref="el => (thumbs[index] = el as HTMLImageElement | null)"
            :src="photo.value.url"
            :alt="photo.value.alt || place.name?.value || ''"
            class="h-full w-auto object-cover"
            @load="onLoad(index, $event)"
            @error="onError(index)"
          />
          <div
            v-if="failed.has(index)"
            class="absolute inset-0 flex items-center justify-center bg-muted px-4 text-center text-xs text-muted-foreground"
          >
            {{ t('place.gallery.failedToLoad') }}
          </div>
        </button>
      </div>

      <ImageLightbox
        v-model:index="openIndex"
        :images="lightboxImages"
        :thumb-for="thumbFor"
        @close="openIndex = null"
      />
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
</style>
