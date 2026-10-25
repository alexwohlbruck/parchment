// A bubble pinned to the map by its tail, as one DOM marker rebuilt only when what it shows changes.

import { Marker, type Map as MaplibreMap } from 'maplibre-gl'
import type { LngLat } from '@/types/map.types'
import { MIRROR_TRANSFORM } from '@/lib/directions/maneuver-icon'

/** Where the bubble sits relative to its point. */
export type CalloutPlacement = 'left' | 'right' | 'above'

export interface CalloutView {
  at: LngLat
  placement: CalloutPlacement
  /** A stroked path in a 24×24 box. */
  icon: { d: string; stroke: number; mirrored?: boolean }
  text: string | null
  background: string
  foreground: string
  /** Smaller type, for bubbles secondary to the turn's. */
  small?: boolean
}

const ANCHOR = { left: 'bottom-right', right: 'bottom-left', above: 'bottom' } as const
const TAIL_CLIP = {
  left: 'polygon(0 0, 100% 0, 100% 100%)',
  right: 'polygon(0 0, 100% 0, 0 100%)',
  above: 'polygon(0 0, 100% 0, 50% 100%)',
}

export class CalloutMarker {
  private marker: Marker | null = null
  private key = ''

  constructor(private readonly map: MaplibreMap) {}

  show(view: CalloutView | null): void {
    if (!view) return this.hide()
    const { at, ...look } = view
    const key = JSON.stringify(look)
    if (this.marker && key === this.key) {
      this.marker.setLngLat(at)
      return
    }
    this.hide()
    this.key = key
    // The tail's tip is the anchor, so the bubble points at `at`.
    this.marker = new Marker({ element: bubble(view), anchor: ANCHOR[view.placement] }).setLngLat(at).addTo(this.map)
  }

  hide(): void {
    this.marker?.remove()
    this.marker = null
    this.key = ''
  }
}

const SVG = 'http://www.w3.org/2000/svg'

function glyph({ d, stroke, mirrored }: CalloutView['icon'], small: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', `${small ? 'size-4' : 'size-[18px]'} shrink-0`)
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', String(stroke))
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', d)
  if (mirrored) path.setAttribute('transform', MIRROR_TRANSFORM)
  svg.append(path)
  return svg
}

function labelClass(placement: CalloutPlacement, small: boolean, text: boolean): string {
  const corner = placement === 'left' ? 'rounded-br-none' : placement === 'right' ? 'rounded-bl-none' : ''
  const size = small ? 'text-[13px] rounded-lg' : 'text-[15px] rounded-xl'
  const pad = !text ? 'p-1.5' : small ? 'py-1 pl-1.5 pr-2.5' : 'py-1.5 pl-2 pr-3'
  return `flex max-w-56 items-center gap-1.5 font-semibold leading-tight shadow-lg ${size} ${pad} ${corner}`
}

function bubble({ placement, icon, text, background, foreground, small = false }: CalloutView): HTMLElement {
  const root = document.createElement('div')
  root.className = `pointer-events-none flex select-none flex-col ${placement === 'left' ? 'items-end' : placement === 'right' ? 'items-start' : 'items-center'}`
  const label = document.createElement('div')
  label.className = labelClass(placement, small, !!text)
  label.style.background = background
  label.style.color = foreground
  label.append(glyph(icon, small))
  if (text) {
    const name = document.createElement('span')
    name.className = 'truncate'
    name.textContent = text
    label.append(name)
  }
  const tail = document.createElement('div')
  tail.className = placement === 'above' ? 'h-2 w-3' : 'h-2.5 w-3'
  tail.style.background = background
  tail.style.clipPath = TAIL_CLIP[placement]
  root.append(label, tail)
  return root
}
