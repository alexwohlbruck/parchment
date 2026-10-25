// The next turn's bubble as one DOM marker, rebuilt only when what it says changes.

import { Marker, type Map as MaplibreMap } from 'maplibre-gl'
import type { LngLat } from '@/types/map.types'
import type { CalloutSide } from '@/lib/guidance/turn-callout'

export interface CalloutView {
  at: LngLat
  side: CalloutSide
  text: string
  color: string
}

export class TurnCalloutMarker {
  private marker: Marker | null = null
  private key = ''

  constructor(private readonly map: MaplibreMap) {}

  show(view: CalloutView | null): void {
    if (!view) return this.hide()
    const key = `${view.side}|${view.text}|${view.color}`
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

function bubble({ side, text, color }: CalloutView): HTMLElement {
  const root = document.createElement('div')
  root.className = 'pointer-events-none select-none'
  const label = document.createElement('div')
  label.className = `max-w-48 truncate rounded-xl px-3 py-1.5 text-[15px] font-semibold leading-tight text-white shadow-lg ${side === 'left' ? 'rounded-br-none' : 'rounded-bl-none'}`
  label.style.background = color
  label.textContent = text
  const tail = document.createElement('div')
  tail.className = `h-2.5 w-3 ${side === 'left' ? 'ml-auto' : ''}`
  tail.style.background = color
  tail.style.clipPath = side === 'left' ? 'polygon(0 0, 100% 0, 100% 100%)' : 'polygon(0 0, 100% 0, 0 100%)'
  root.append(label, tail)
  return root
}
