import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import en from '@/lib/i18n/en-US.json'
import PlaceGallery from './PlaceGallery.vue'
import { clearImageSizeCache, getCachedImageSize } from '@/components/ui/lightbox/imageSize'

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': en } })

// PhotoSwipe wants a real layout engine; the gallery's own behaviour is what
// matters here, so the lightbox is reduced to the props it receives.
const ImageLightboxStub = {
  name: 'ImageLightbox',
  props: ['images', 'index', 'thumbFor'],
  template: '<div data-testid="lightbox" />',
}

function photo(url: string, extra: Record<string, unknown> = {}) {
  return { value: { url, sourceId: 'google', ...extra }, sourceId: 'google' }
}

function mountGallery(photos: ReturnType<typeof photo>[]) {
  return mount(PlaceGallery, {
    props: { place: { name: { value: 'Cafe' }, photos } as never },
    global: {
      plugins: [i18n],
      stubs: { ImageLightbox: ImageLightboxStub, TransitionExpand: false },
    },
  })
}

describe('PlaceGallery', () => {
  beforeEach(() => clearImageSizeCache())

  it('excludes the brand logo, which belongs in the header', () => {
    const w = mountGallery([
      photo('/logo.png', { isLogo: true }),
      photo('/a.jpg'),
      photo('/b.jpg'),
    ])
    expect(w.findAll('img')).toHaveLength(2)
    expect(w.findComponent(ImageLightboxStub).props('images')).toEqual([
      { src: '/a.jpg', alt: 'Cafe', width: undefined, height: undefined },
      { src: '/b.jpg', alt: 'Cafe', width: undefined, height: undefined },
    ])
  })

  it('opens the lightbox at the photo that was clicked', async () => {
    const w = mountGallery([photo('/a.jpg'), photo('/b.jpg'), photo('/c.jpg')])
    const lightbox = w.findComponent(ImageLightboxStub)
    expect(lightbox.props('index')).toBeNull()

    await w.findAll('button')[2].trigger('click')
    expect(lightbox.props('index')).toBe(2)
  })

  it('passes provider dimensions through and labels each thumbnail', () => {
    const w = mountGallery([photo('/a.jpg', { width: 1600, height: 900, alt: 'Patio' })])
    expect(w.findComponent(ImageLightboxStub).props('images')[0]).toEqual({
      src: '/a.jpg',
      alt: 'Patio',
      width: 1600,
      height: 900,
    })
    expect(w.find('button').attributes('aria-label')).toBe('View photo 1 of 1')
  })

  it('records the thumbnail size so the lightbox needs no second request', async () => {
    const w = mountGallery([photo('/a.jpg')])
    const img = w.find('img')
    Object.defineProperty(img.element, 'naturalWidth', { value: 2000 })
    Object.defineProperty(img.element, 'naturalHeight', { value: 1000 })
    Object.defineProperty(img.element, 'currentSrc', { value: '/a.jpg' })

    await img.trigger('load')
    expect(getCachedImageSize('/a.jpg')).toEqual({ width: 2000, height: 1000 })
    expect(w.emitted('imageLoaded')).toHaveLength(1)
  })

  it('shows the failure message only on the photo that failed', async () => {
    const w = mountGallery([photo('/a.jpg'), photo('/broken.jpg')])
    expect(w.text()).not.toContain('Failed to load image')

    await w.findAll('img')[1].trigger('error')
    expect(w.emitted('imageError')).toHaveLength(1)
    expect(w.findAll('button')[0].text()).not.toContain('Failed to load image')
    expect(w.findAll('button')[1].text()).toContain('Failed to load image')
  })

  it('hands the lightbox the thumbnail each photo should zoom out of', () => {
    const w = mountGallery([photo('/a.jpg'), photo('/b.jpg')])
    const thumbFor = w.findComponent(ImageLightboxStub).props('thumbFor')
    expect(thumbFor(1)).toBe(w.findAll('img')[1].element)
  })

  it('renders nothing when a place has no photos', () => {
    const w = mountGallery([])
    expect(w.find('img').exists()).toBe(false)
    expect(w.findComponent(ImageLightboxStub).exists()).toBe(false)
  })

  it('closes the lightbox when the photo set changes underneath it', async () => {
    const w = mountGallery([photo('/a.jpg'), photo('/b.jpg')])
    await w.findAll('button')[1].trigger('click')
    expect(w.findComponent(ImageLightboxStub).props('index')).toBe(1)

    await w.setProps({ place: { name: { value: 'Bar' }, photos: [photo('/z.jpg')] } as never })
    expect(w.findComponent(ImageLightboxStub).props('index')).toBeNull()
  })
})
