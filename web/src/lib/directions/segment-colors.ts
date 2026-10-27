import { getTravelModeCaseColor, getTravelModeColor } from './travel-mode-colors'
import { adjustLightness } from '@/lib/utils'

type ColoredSegment = { mode: string; lineColor?: string | null }

export function getSegmentColor(segment: ColoredSegment): string {
  const color = segment.lineColor
  return color ? (color.startsWith('#') ? color : `#${color}`) : getTravelModeColor(segment.mode)
}

export function getSegmentCaseColor(segment: ColoredSegment): string {
  return segment.lineColor ? adjustLightness(getSegmentColor(segment), -12) : getTravelModeCaseColor(segment.mode)
}
