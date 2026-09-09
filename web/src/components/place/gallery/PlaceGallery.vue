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

/**
 * The lightbox asks for a thumbnail only when it needs its bounds — to zoom out
 * of on opening, and back into on closing. Landing the strip first means those
 * bounds are where the thumbnail is about to be, not mid-glide, so the closing
 * photo shrinks onto it instead of chasing it.
 */
function thumbFor(index: number) {
  settleScroll()
  return thumbs.value[index]
}

/** The horizontal strip itself, so swiping the lightbox can keep pace with it. */
const strip = ref<HTMLElement | null>(null)

const failed = ref(new Set<number>())

/** Where the strip is gliding to, so the glide can be landed early. */
let scrollTarget: number | null = null

/**
 * Cut any in-flight glide short and jump to its destination — `auto` cancels a
 * running smooth scroll.
 */
function settleScroll() {
  if (scrollTarget === null) return
  strip.value?.scrollTo({ left: scrollTarget, behavior: 'auto' })
  scrollTarget = null
}

/**
 * Keep the strip on whichever photo the lightbox is showing. It is visible
 * through the scrim, so it glides; and it is what makes closing land, since
 * PhotoSwipe zooms back to the thumbnail's bounds and after a few swipes that
 * thumbnail would otherwise be scrolled out of sight, sending the photo
 * shrinking off the edge of the screen.
 */
watch(openIndex, index => {
  if (index === null) {
    scrollTarget = null
    return
  }
  const thumb = thumbs.value[index]
  const container = strip.value
  if (!thumb || !container) return

  // Measured rather than derived from offsetLeft: the thumbnail's offsetParent
  // is its own button, so offsets are not in the scroller's coordinates. Moving
  // the strip itself also leaves every ancestor alone, which scrollIntoView
  // would not — the sheet this sits in would scroll too.
  const thumbBox = thumb.getBoundingClientRect()
  const stripBox = container.getBoundingClientRect()
  const delta
    = thumbBox.left - stripBox.left - (stripBox.width - thumbBox.width) / 2

  if (Math.abs(delta) < 1) return

  const limit = container.scrollWidth - container.clientWidth
  scrollTarget = Math.max(0, Math.min(container.scrollLeft + delta, limit))
  container.scrollTo({
    left: scrollTarget,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
  })
})

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
        ref="strip"
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
