import type { RouteEdgeSegment } from '@/types/directions.types'
import { getEdgeCategory, type RouteProfileType } from './route-profile-colors'

export interface ProfileStat { key: string; label: string; color: string; percentage: number }

/** Share of distance in each of a profile's categories, largest first. */
export function profileStats(segments: RouteEdgeSegment[], profile: RouteProfileType): ProfileStat[] {
  const totals = new Map<string, { distance: number; label: string; color: string }>()
  let total = 0
  for (const seg of segments) {
    const cat = getEdgeCategory(profile, seg)
    const dist = seg.endDistance - seg.startDistance
    total += dist
    const existing = totals.get(cat.group)
    if (existing) existing.distance += dist
    else totals.set(cat.group, { distance: dist, label: cat.label, color: cat.color })
  }
  if (total === 0) return []
  return [...totals.values()]
    .map(g => ({ key: g.label, label: g.label, color: g.color, percentage: Math.round((g.distance / total) * 100) }))
    .filter(g => g.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage)
}

const MIXED_LABELS: Record<RouteProfileType, string> = {
  surface: 'Mixed surfaces',
  incline: 'Varied terrain',
  stress: 'Mixed suitability',
  infrastructure: 'Mixed infrastructure',
}

/** One line for a profile's stats: its main category, or that it is mixed. */
export function profileSummary(stats: ProfileStat[], profile: RouteProfileType): string {
  if (!stats.length) return ''
  const [top, next] = stats
  if (top.percentage >= 90) return top.label
  if (top.percentage >= 65) return `Mostly ${top.label.toLowerCase()}`
  if (stats.length === 2 && next.percentage >= 25) return `${top.label} & ${next.label.toLowerCase()}`
  return MIXED_LABELS[profile]
}
