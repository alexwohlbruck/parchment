import { formatDurationCompact } from '@/lib/time-format'
import type { TransitStage } from './transit-progress'

type TFn = (key: string, named?: Record<string, unknown>) => string

const DEPARTING_NOW_SEC = 30

/** "Departs in 4m", or "Departing now" in its last half minute. */
export function departureText(departureMs: number, nowMs: number, t: TFn): string {
  const sec = (departureMs - nowMs) / 1000
  return sec < DEPARTING_NOW_SEC ? t('guidance.transit.departingNow') : t('guidance.transit.departsIn', { duration: formatDurationCompact(sec) })
}

/** When to get off, as the ride's headline. */
export function alightText(stage: Extract<TransitStage, { kind: 'riding' }>, t: TFn): string {
  if (stage.alighting) return t('guidance.transit.getOffNow')
  return stage.stopsLeft === 1 ? t('guidance.transit.getOffNext') : t('guidance.transit.getOffAt', { stop: stage.alight })
}

/** The line a waiting or riding stage leads with, or null for a stage that needs the full card. */
export function stageHeadline(stage: TransitStage, nowMs: number, t: TFn): string | null {
  if (stage.kind === 'wait') return departureText(stage.departureMs, nowMs, t)
  if (stage.kind === 'riding') return alightText(stage, t)
  return null
}
