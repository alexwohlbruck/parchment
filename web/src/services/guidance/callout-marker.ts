// The next turn's bubble as one DOM marker, rebuilt only when what it says changes.

import { Marker, type Map as MaplibreMap } from 'maplibre-gl'
import type { LngLat } from '@/types/map.types'
import type { CalloutSide } from '@/lib/guidance/turn-callout'
import type { ManeuverKind } from '@/lib/directions/maneuver'
import { maneuverIcon, MANEUVER_ICON_STROKE, MANEUVER_ICON_VIEWBOX, MIRROR_TRANSFORM } from '@/lib/directions/maneuver-icon'

export interface CalloutView {
  at: LngLat
  side: CalloutSide
  kind: ManeuverKind
  text: string
  color: string
}

export class TurnCalloutMarker {
  private marker: Marker | null = null
  private key = ''

  constructor(private readonly map: MaplibreMap) {}

  show(view: CalloutView | null): void {
    if (!view) return this.hide()
    const key = `${view.side}|${view.kind}|${view.text}|${view.color}`
    if (this.marker && key === this.key) {
      this.marker.setLngLat(view.at)
      return
    }
    this.hide()
    this.key = key
    // The tail's tip is the bubble's outer bottom corner, so that corner is the anchor.
    this.marker = new Marker({ element: bubble(view), anchor: view.side === 'left' ? 'bottom-right' : 'bottom-left' })
      .setLngLat(view.at)
      .addTo(this.map)
  }

  hide(): void {
    this.marker?.remove()
    this.marker = null
    this.key = ''
  }
}

const SVG = 'http://www.w3.org/2000/svg'

function arrow(kind: ManeuverKind): SVGSVGElement {
  const { d, mirrored } = maneuverIcon(kind)
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', MANEUVER_ICON_VIEWBOX)
  svg.setAttribute('class', 'size-[18px] shrink-0')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', String(MANEUVER_ICON_STROKE))
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG, 'path')
  path.setAttribute('d', d)
  if (mirrored) path.setAttribute('transform', MIRROR_TRANSFORM)
  svg.append(path)
  return svg
}

function bubble({ side, kind, text, color }: CalloutView): HTMLElement {
  const root = document.createElement('div')
  root.className = 'pointer-events-none select-none'
  const label = document.createElement('div')
  label.className = `flex max-w-56 items-center gap-1.5 rounded-xl py-1.5 pl-2 pr-3 text-[15px] font-semibold leading-tight text-white shadow-lg ${side === 'left' ? 'rounded-br-none' : 'rounded-bl-none'}`
  label.style.background = color
  const name = document.createElement('span')
  name.className = 'truncate'
  name.textContent = text
  label.append(arrow(kind), name)
  const tail = document.createElement('div')
  tail.className = `h-2.5 w-3 ${side === 'left' ? 'ml-auto' : ''}`
  tail.style.background = color
  tail.style.clipPath = side === 'left' ? 'polygon(0 0, 100% 0, 100% 100%)' : 'polygon(0 0, 100% 0, 0 100%)'
  root.append(label, tail)
  return root
}
