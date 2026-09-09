/**
 * Trip Instructions Marker Layer
 * 
 * Shows instruction point markers for a single trip.
 * Automatically updates when trip data or highlight state changes.
 */

import { ref, type Ref } from 'vue'
import { BaseMarkerLayer, type MarkerData } from './base-marker-layer'
import InstructionPointMarker from '@/components/map/InstructionPointMarker.vue'

interface TripData {
  segments: Array<{
    mode: string
    instructions?: Array<{
      text: string
      coordinate?: { lat: number; lng: number }
    }>
  }>
}

export class TripInstructionsLayer extends BaseMarkerLayer {
  private currentTrip: Ref<TripData | null> = ref(null)
  private highlightedInstruction: Ref<{ segmentIndex: number; instructionIndex: number } | null> = ref(null)

  constructor() {
    super({
      idPrefix: 'instruction-',
      component: InstructionPointMarker,
      zIndex: 1, // Lowest priority - below other markers
    })
  }

  protected getData(): MarkerData[] {
    const trip = this.currentTrip.value
    if (!trip) return []

    const markers: MarkerData[] = []

    trip.segments.forEach((segment, segmentIndex) => {
      const instructionsWithCoords = segment.instructions?.filter(
        (instr): instr is { text: string; coordinate: { lat: number; lng: number } } => 
          typeof instr === 'object' && instr.coordinate !== undefined
      ) || []

      const segmentColor = this.getSegmentColor(segment.mode)

      instructionsWithCoords.forEach((instruction, instrIndex) => {
        const key = `${segmentIndex}-${instrIndex}`
        const isHighlighted = this.highlightedInstruction.value?.segmentIndex === segmentIndex &&
          this.highlightedInstruction.value?.instructionIndex === instrIndex

        markers.push({
          id: key,
          lngLat: { lat: instruction.coordinate.lat, lng: instruction.coordinate.lng },
          props: {
            text: instruction.text,
            segmentColor,
            isHighlighted,
          },
        })
      })
    })

    return markers
  }

  /**
   * Set the trip to show instruction markers for
   */
  setTrip(trip: TripData | null) {
    this.currentTrip.value = trip
  }

  /**
   * Highlight a specific instruction
   */
  highlightInstruction(segmentIndex: number, instructionIndex: number) {
    this.highlightedInstruction.value = { segmentIndex, instructionIndex }
  }

  /**
   * Clear highlighted instruction
   */
  clearHighlight() {
    this.highlightedInstruction.value = null
  }

  /**
   * Get color for segment based on mode
   */
  private getSegmentColor(mode: string): string {
    const modeColors: Record<string, string> = {
      walking: '#0089e9',
      biking: '#7ca06a',
      cycling: '#7ca06a',
      driving: '#7965f0',
      transit: '#a18559',
      truck: '#f86f3b',
    }
    return modeColors[mode] || '#0089e9'
  }
}
