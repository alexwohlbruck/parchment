export interface Size {
  width: number
  height: number
}

/** Image placement inside a square viewport, in viewport pixels. */
export interface CropState {
  x: number
  y: number
  zoom: number
}

export const MAX_ZOOM = 4

/** The scale at which the image's shorter side exactly fills the viewport. */
export function coverScale(image: Size, viewport: number) {
  return viewport / Math.min(image.width, image.height)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** Keeps the image covering the whole viewport, with zoom within [1, MAX_ZOOM]. */
export function clampCrop(state: CropState, image: Size, viewport: number): CropState {
  const zoom = clamp(state.zoom, 1, MAX_ZOOM)
  const scale = coverScale(image, viewport) * zoom
  return {
    zoom,
    x: clamp(state.x, viewport - image.width * scale, 0),
    y: clamp(state.y, viewport - image.height * scale, 0),
  }
}

/** The image centered and just covering the viewport. */
export function initialCrop(image: Size, viewport: number): CropState {
  const scale = coverScale(image, viewport)
  return {
    zoom: 1,
    x: (viewport - image.width * scale) / 2,
    y: (viewport - image.height * scale) / 2,
  }
}

/** Zooms while keeping the image point under `focus` (viewport pixels) fixed. */
export function zoomAround(
  state: CropState,
  zoom: number,
  focus: { x: number; y: number },
  image: Size,
  viewport: number,
): CropState {
  const next = clamp(zoom, 1, MAX_ZOOM)
  const ratio = next / state.zoom
  return clampCrop(
    {
      zoom: next,
      x: focus.x - (focus.x - state.x) * ratio,
      y: focus.y - (focus.y - state.y) * ratio,
    },
    image,
    viewport,
  )
}

/** The square of the source image, in image pixels, that the viewport shows. */
export function sourceRect(state: CropState, image: Size, viewport: number) {
  const scale = coverScale(image, viewport) * state.zoom
  return {
    x: -state.x / scale,
    y: -state.y / scale,
    size: viewport / scale,
  }
}
