<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PhotoSwipeLightbox from 'photoswipe/lightbox'
import type PhotoSwipe from 'photoswipe'
import type { SlideData } from 'photoswipe'
import 'photoswipe/style.css'
import { getCachedImageSize, measureImage } from './imageSize'

export interface LightboxImage {
  /** Full-size source. The thumbnail may point at the same URL. */
  src: string
  alt?: string
  caption?: string
  /** Provider-reported size, when there is one. Measured otherwise. */
  width?: number
  height?: number
}

const props = defineProps<{
  images: LightboxImage[]
  /** Index of the open image; null closes the lightbox. */
  index: number | null
  /**
   * The thumbnail an image zooms out of. Without it PhotoSwipe falls back to
   * a cross-fade, which reads as a jump rather than the photo growing.
   */
  thumbFor?: (index: number) => HTMLElement | null | undefined
}>()

const emit = defineEmits<{
  (e: 'update:index', index: number): void
  (e: 'close'): void
}>()

const { t } = useI18n()

/**
 * Until an image has been measured we have to guess, or PhotoSwipe cannot size
 * the slide at all. 3:2 is the least-wrong default for place photography; the
 * slide is refreshed the moment the real size arrives.
 */
const FALLBACK_ASPECT = 3 / 2
const FALLBACK_WIDTH = 1500

/** Breathing room for the chrome above and below the photo. */
const CHROME_PADDING = 56

/**
 * PhotoSwipe takes its slide padding in pixels, so the notch and home
 * indicator have to be measured rather than left to `env()` in CSS.
 */
function safeAreaInsets() {
  const probe = document.createElement('div')
  probe.style.cssText
    = 'position:fixed;visibility:hidden;pointer-events:none;'
      + 'top:env(safe-area-inset-top);bottom:env(safe-area-inset-bottom)'
  document.body.append(probe)
  const style = getComputedStyle(probe)
  const insets = {
    top: Number.parseFloat(style.top) || 0,
    bottom: Number.parseFloat(style.bottom) || 0,
  }
  probe.remove()
  return insets
}

let lightbox: PhotoSwipeLightbox | null = null
let pswp: PhotoSwipe | null = null
/** Set while we drive PhotoSwipe, so its `change` echo does not loop back. */
let syncing = false

function slideFor(image: LightboxImage | undefined): SlideData {
  if (!image) return { width: FALLBACK_WIDTH, height: FALLBACK_WIDTH / FALLBACK_ASPECT }

  const measured
    = (image.width && image.height ? { width: image.width, height: image.height } : undefined)
      ?? getCachedImageSize(image.src)

  return {
    src: image.src,
    alt: image.alt,
    width: measured?.width ?? FALLBACK_WIDTH,
    height: measured?.height ?? FALLBACK_WIDTH / FALLBACK_ASPECT,
  }
}

/**
 * Measure anything still unknown and re-lay-out the slide once it lands. The
 * clicked image is awaited before opening (it is already on screen, so this is
 * a cache hit); its neighbours resolve in the background.
 */
async function resolveSize(index: number) {
  const image = props.images[index]
  if (!image || (image.width && image.height) || getCachedImageSize(image.src)) return

  const size = await measureImage(image.src)
  if (size && pswp) pswp.refreshSlideContent(index)
}

function buildCaption(pswpInstance: PhotoSwipe) {
  pswpInstance.on('uiRegister', () => {
    pswpInstance.ui?.registerElement({
      name: 'caption',
      order: 9,
      isButton: false,
      appendTo: 'root',
      html: '',
      onInit: (el) => {
        const render = () => {
          const caption = props.images[pswpInstance.currIndex]?.caption?.trim()
          el.textContent = caption ?? ''
          el.classList.toggle('pswp__caption--empty', !caption)
        }
        pswpInstance.on('change', render)
        render()
      },
    })
  })
}

async function open(index: number) {
  if (!props.images.length) return

  // The clicked photo needs a real size before the opening zoom, or it
  // animates to the wrong frame and settles with a visible jolt.
  await resolveSize(index)
  if (props.index === null) return

  const insets = safeAreaInsets()

  lightbox = new PhotoSwipeLightbox({
    dataSource: props.images.map((_, i) => slideFor(props.images[i])),
    pswpModule: () => import('photoswipe'),

    // Opening/closing: the photo grows out of its thumbnail on the same
    // easing the bottom sheet uses, so the two motions feel related.
    showHideAnimationType: 'zoom',
    showAnimationDuration: 320,
    hideAnimationDuration: 260,
    easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
    zoomAnimationDuration: 300,

    bgOpacity: 1,
    padding: {
      top: CHROME_PADDING + insets.top,
      bottom: CHROME_PADDING + insets.bottom,
      left: 0,
      right: 0,
    },
    loop: false,
    // Trackpad pinch and plain wheel both zoom; ctrl is not discoverable.
    wheelToZoom: true,
    doubleTapAction: 'zoom',
    clickToCloseNonZoomable: true,
    // The pinch/double-tap gestures cover zooming, so the button is noise.
    zoom: false,
    counter: props.images.length > 1,
    arrowPrev: props.images.length > 1,
    arrowNext: props.images.length > 1,

    closeTitle: t('general.close'),
    arrowPrevTitle: t('place.gallery.previousPhoto'),
    arrowNextTitle: t('place.gallery.nextPhoto'),
  })

  // Re-read sizes on every layout pass so a slide refreshed after measurement
  // picks up its real dimensions instead of the fallback aspect.
  lightbox.addFilter('itemData', (_itemData, i) => slideFor(props.images[i]))

  if (props.thumbFor) {
    lightbox.addFilter('thumbEl', (thumbEl, _itemData, i) => {
      // Typed as non-nullable, but PhotoSwipe checks for a missing thumbnail
      // and cross-fades instead of zooming — which is what we want here.
      return (props.thumbFor?.(i) ?? thumbEl) as HTMLElement
    })
  }

  lightbox.on('beforeOpen', () => {
    pswp = lightbox?.pswp ?? null
  })

  lightbox.on('afterInit', () => {
    pswp = lightbox?.pswp ?? null
    if (pswp) buildCaption(pswp)
    // Neighbours first — they are the next thing the user can reach.
    props.images.forEach((_, i) => {
      if (i !== index) resolveSize(i)
    })
  })

  lightbox.on('change', () => {
    const current = lightbox?.pswp?.currIndex
    if (current === undefined || current === props.index) return
    syncing = true
    emit('update:index', current)
    syncing = false
  })

  lightbox.on('destroy', () => {
    pswp = null
    lightbox = null
    if (props.index !== null) emit('close')
  })

  lightbox.init()
  lightbox.loadAndOpen(index)
}

function close() {
  lightbox?.pswp?.close()
  lightbox?.destroy()
  lightbox = null
  pswp = null
}

watch(
  () => props.index,
  (index, previous) => {
    if (index === null) {
      close()
      return
    }
    if (previous === null) {
      open(index)
      return
    }
    // Moved while open — from the thumbnail strip, say. Nothing to do when
    // PhotoSwipe is the one that moved.
    if (!syncing) lightbox?.pswp?.goTo(index)
  },
  { immediate: true },
)

onBeforeUnmount(close)
</script>

<template>
  <!-- PhotoSwipe renders into document.body; nothing belongs here. -->
</template>

<style>
/*
 * PhotoSwipe ships a functional but heavy chrome. What is left here is a dark
 * scrim, a counter, and hit targets that disappear until you look for them.
 */
.pswp {
  --pswp-bg: oklch(0.14 0.005 285);
  --pswp-placeholder-bg: transparent;
  --pswp-icon-color: rgb(255 255 255 / 0.92);
  --pswp-icon-color-secondary: transparent;
  --pswp-icon-stroke-width: 0;
  --pswp-error-text-color: var(--pswp-icon-color);
  z-index: 60;
}

/* Chrome fades with the controls rather than snapping in and out. */
.pswp__top-bar,
.pswp__button--arrow,
.pswp__caption {
  transition: opacity 200ms cubic-bezier(0.32, 0.72, 0, 1);
}

.pswp__top-bar {
  padding: max(env(safe-area-inset-top), 0.5rem) 0.5rem 0.5rem;
  background: linear-gradient(to bottom, rgb(0 0 0 / 0.35), transparent);
}

.pswp__button {
  opacity: 0.75;
  transition: opacity 150ms ease, background-color 150ms ease;
  border-radius: 9999px;
}

.pswp__button:hover,
.pswp__button:focus-visible {
  opacity: 1;
  background-color: rgb(255 255 255 / 0.12);
}

.pswp__counter {
  font-family: inherit;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  opacity: 0.75;
  margin-inline-start: 0.75rem;
  height: 3rem;
  line-height: 3rem;
  text-shadow: none;
}

.pswp__button--arrow {
  /* Touch devices swipe; arrows are a pointer affordance. */
  display: none;
}

@media (hover: hover) and (pointer: fine) {
  .pswp__button--arrow {
    display: block;
  }
}

.pswp__caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 1rem 1.25rem calc(max(env(safe-area-inset-bottom), 0.75rem) + 0.5rem);
  color: rgb(255 255 255 / 0.82);
  font-size: 0.8125rem;
  line-height: 1.4;
  text-align: center;
  text-wrap: pretty;
  pointer-events: none;
  background: linear-gradient(to top, rgb(0 0 0 / 0.4), transparent);
}

.pswp__caption--empty {
  display: none;
}

/* Controls hidden (tap-to-toggle) takes the caption with it. */
.pswp--ui-visible .pswp__caption {
  opacity: 1;
}

.pswp:not(.pswp--ui-visible) .pswp__caption {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .pswp__top-bar,
  .pswp__button--arrow,
  .pswp__caption {
    transition: none;
  }
}
</style>
