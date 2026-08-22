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

/**
 * PhotoSwipe's own glyphs are filled shapes on a bespoke 60px grid. These are
 * the Lucide icons the rest of the app draws with, at the same stroke weight,
 * so the lightbox controls are the app's controls.
 */
function lucideIcon(paths: string) {
  return `<svg class="lightbox-icn" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="2" stroke-linecap="round" `
    + `stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

const ICON_CLOSE = lucideIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>')
const ICON_PREV = lucideIcon('<path d="m15 18-6-6 6-6"/>')
const ICON_NEXT = lucideIcon('<path d="m9 18 6-6-6-6"/>')

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
    // PhotoSwipe paints `msrc` during the opening zoom while the full image is
    // still being decoded; without it the animation runs against an empty
    // frame and the photo only pops in once it lands. It sets this itself when
    // it parses a DOM gallery, but not for a dataSource array. The strip shows
    // this very URL, so it is already in cache and paints immediately.
    msrc: image.src,
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

/**
 * Escape is ours alone while the lightbox is open. PhotoSwipe binds keydown on
 * document and so does Mousetrap, which the bottom sheet uses to close the
 * place — so one press used to dismiss both. Claiming it in the capture phase
 * on window stops it before either sees it.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !pswp) return
  event.preventDefault()
  event.stopImmediatePropagation()
  pswp.close()
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

    // A translucent scrim rather than a void, so the place stays visible
    // behind it the way it does under the app's other overlays.
    bgOpacity: 0.88,
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
    // Handled by onKeydown, which also stops the press escaping to the page.
    escKey: false,

    closeTitle: t('general.close'),
    arrowPrevTitle: t('place.gallery.previousPhoto'),
    arrowNextTitle: t('place.gallery.nextPhoto'),
    closeSVG: ICON_CLOSE,
    arrowPrevSVG: ICON_PREV,
    arrowNextSVG: ICON_NEXT,
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
    window.addEventListener('keydown', onKeydown, true)
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
    window.removeEventListener('keydown', onKeydown, true)
    pswp = null
    lightbox = null
    if (props.index !== null) emit('close')
  })

  lightbox.init()
  lightbox.loadAndOpen(index)
}

function close() {
  window.removeEventListener('keydown', onKeydown, true)
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
 * PhotoSwipe ships a black void with flat white icons. This dresses it in the
 * app's own surfaces instead: a warm blurred scrim over the place, and chrome
 * that floats above the photo as the same bordered, translucent pills used for
 * the map controls and the command palette.
 */
.pswp {
  --pswp-bg: hsl(var(--background));
  --pswp-placeholder-bg: transparent;
  --pswp-icon-color: hsl(var(--foreground));
  --pswp-icon-color-secondary: transparent;
  --pswp-icon-stroke-width: 0;
  --pswp-error-text-color: hsl(var(--muted-foreground));

  /* Shared by every floating control below. */
  --lightbox-chrome-bg: hsl(var(--background) / 0.8);
  --lightbox-chrome-border: 1px solid hsl(var(--border) / 0.6);
  --lightbox-chrome-blur: blur(12px) saturate(140%);
  /* Matches the `depth` utility: the drop shadow stays black in both themes,
     only the inset highlight dims. Deriving it from --foreground inverted it
     into a white glow in dark mode. */
  --lightbox-chrome-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.7),
    0 1px 3px rgb(0 0 0 / 0.08);

  z-index: 60;
}

.dark .pswp {
  --lightbox-chrome-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.05),
    0 1px 3px rgb(0 0 0 / 0.08);
}

.pswp__bg {
  backdrop-filter: blur(16px) saturate(140%);
}

/*
 * No radius or shadow on the photo. PhotoSwipe opens and zooms by scaling this
 * element, and a border-radius is scaled with it — a 12px corner renders at
 * 12px x scale through the whole animation and only snaps to size at the end,
 * which reads as the corners being clipped. Counter-scaling it would mean
 * rewriting the radius every frame. The chrome below is not scaled, so it
 * keeps the app's radius and depth.
 */

/* The bar itself is only a layout row; the controls in it are the surfaces. */
.pswp__top-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: auto;
  padding: calc(max(env(safe-area-inset-top), 0px) + 0.75rem) 0.75rem 0;
  background: none;
}

.pswp__top-bar,
.pswp__button--arrow,
.pswp__caption {
  transition: opacity 200ms cubic-bezier(0.32, 0.72, 0, 1);
}

.pswp__button {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius);
  background: var(--lightbox-chrome-bg);
  border: var(--lightbox-chrome-border);
  backdrop-filter: var(--lightbox-chrome-blur);
  box-shadow: var(--lightbox-chrome-shadow);
  color: hsl(var(--foreground));
  opacity: 1;
  transition:
    background-color 150ms ease,
    transform 150ms cubic-bezier(0.32, 0.72, 0, 1);
}

.pswp__button:hover {
  background: hsl(var(--accent) / 0.9);
}

.pswp__button:active {
  transform: translateY(1px);
}

.pswp__button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px hsl(var(--ring));
}

/* Centred in the square hit box, rather than PhotoSwipe's 50x60 offsets. */
.pswp__button .lightbox-icn {
  position: absolute;
  inset: 0;
  width: 1.125rem;
  height: 1.125rem;
  margin: auto;
}

.pswp__counter {
  display: flex;
  align-items: center;
  height: 2.25rem;
  margin: 0;
  padding: 0 0.75rem;
  border-radius: 9999px;
  background: var(--lightbox-chrome-bg);
  border: var(--lightbox-chrome-border);
  backdrop-filter: var(--lightbox-chrome-blur);
  box-shadow: var(--lightbox-chrome-shadow);
  color: hsl(var(--muted-foreground));
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  opacity: 1;
  text-shadow: none;
}

/* Close sits at the far end of the row, opposite the counter. */
.pswp__button--close {
  margin-inline-start: auto;
}

.pswp__button--arrow {
  /* Touch devices swipe; arrows are a pointer affordance. */
  display: none;
  width: 2.25rem;
  height: 2.25rem;
  margin-top: -1.125rem;
}

@media (hover: hover) and (pointer: fine) {
  .pswp__button--arrow {
    display: block;
  }
}

.pswp__button--arrow--prev {
  inset-inline-start: 0.75rem;
}

.pswp__button--arrow--next {
  inset-inline-end: 0.75rem;
}

.pswp__caption {
  position: absolute;
  left: 50%;
  bottom: calc(max(env(safe-area-inset-bottom), 0px) + 0.75rem);
  transform: translateX(-50%);
  max-width: min(36rem, calc(100% - 1.5rem));
  padding: 0.5rem 0.875rem;
  border-radius: calc(var(--radius) + 0.25rem);
  background: var(--lightbox-chrome-bg);
  border: var(--lightbox-chrome-border);
  backdrop-filter: var(--lightbox-chrome-blur);
  box-shadow: var(--lightbox-chrome-shadow);
  color: hsl(var(--muted-foreground));
  font-size: 0.8125rem;
  line-height: 1.4;
  text-align: center;
  text-wrap: pretty;
  pointer-events: none;
}

.pswp__caption--empty {
  display: none;
}

/* Controls hidden (tap-to-toggle) takes the caption with it. */
.pswp:not(.pswp--ui-visible) .pswp__caption {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .pswp__button,
  .pswp__top-bar,
  .pswp__button--arrow,
  .pswp__caption {
    transition: none;
  }
}
</style>
