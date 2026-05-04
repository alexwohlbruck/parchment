import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { TrainIcon, BusIcon } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { TransitDeparture } from '@/types/place.types'

dayjs.extend(customParseFormat)

export type TFn = (key: string) => string

/**
 * Wall-clock time of a departure (HH:mm), preferring the server-computed
 * absolute timestamp (service_date + time + timezone) over the bare
 * HH:mm:ss field, which can't be disambiguated as today vs tomorrow vs
 * GTFS late-night service hours.
 */
export function formatDepartureTime(dep: TransitDeparture): string {
  const absolute = dep.departureAt || dep.arrivalAt
  if (absolute) {
    const t = dayjs(absolute)
    if (t.isValid()) return t.format('HH:mm')
  }
  const timeString = dep.departureTime || dep.arrivalTime
  if (!timeString) return '--'
  const time = dayjs(timeString, 'HH:mm:ss')
  return time.isValid() ? time.format('HH:mm') : '--'
}

/**
 * Minutes from `now` until the departure. Negative for past, positive for
 * future, null for unknown. Prefers absolute timestamps. Falls back to the
 * legacy "today, bumped to tomorrow if past" interpretation when the
 * adapter only supplies bare HH:mm:ss (older feeds).
 */
export function getMinutesUntil(
  dep: TransitDeparture,
  now: Date | dayjs.Dayjs,
): number | null {
  const absolute = dep.departureAt || dep.arrivalAt
  if (absolute) {
    const t = dayjs(absolute)
    if (t.isValid()) return t.diff(dayjs(now), 'minute')
  }
  const timeString = dep.departureTime || dep.arrivalTime
  if (!timeString) return null
  const nowD = dayjs(now)
  const time = dayjs(timeString, 'HH:mm:ss')
  if (!time.isValid()) return null
  let datetime = nowD.hour(time.hour()).minute(time.minute()).second(time.second())
  let diff = datetime.diff(nowD, 'minute')
  if (diff < 0) {
    datetime = datetime.add(1, 'day')
    diff = datetime.diff(nowD, 'minute')
  }
  return diff
}

/**
 * Render a minutes-until value as a short countdown. Handles past
 * (negative → " ago"), now (0), and future, with hour/day rollups for
 * readability.
 */
export function formatCountdown(minutes: number | null, t: TFn): string {
  if (minutes === null) return ''
  if (minutes === 0) return t('place.transit.now')

  if (minutes < 0) {
    const ago = -minutes
    if (ago === 1) return `1 ${t('place.transit.min')} ago`
    if (ago > 60) {
      const hours = Math.floor(ago / 60)
      const mins = ago % 60
      return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`
    }
    return `${ago} ${t('place.transit.min')} ago`
  }

  if (minutes === 1) return `1 ${t('place.transit.min')}`
  if (minutes > 1440) {
    const days = Math.floor(minutes / 1440)
    return `${days}d`
  }
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
  return `${minutes} ${t('place.transit.min')}`
}

/** Tailwind class string for the countdown number, color-coded by urgency. */
export function getCountdownClass(minutes: number | null): string {
  if (minutes === null) return 'text-muted-foreground'
  if (minutes < 0) return 'text-muted-foreground/70'
  if (minutes <= 5) return 'text-emerald-600 font-medium'
  if (minutes <= 15) return 'text-amber-600 font-medium'
  return 'text-muted-foreground'
}

/** GTFS route_type → an icon component to badge the route. */
export function getRouteTypeIcon(routeType?: number): Component {
  switch (routeType) {
    case 0:
    case 1:
    case 2:
      return TrainIcon
    case 3:
    default:
      return BusIcon
  }
}

/** Hex color for the route badge background; falls back to the app primary. */
export function getRouteColor(route: TransitDeparture['route']): string {
  if (route.color) return `#${route.color.replace('#', '')}`
  return 'hsl(var(--primary))'
}

/** Hex color for text laid over `getRouteColor`; defaults to white. */
export function getTextColor(route: TransitDeparture['route']): string {
  if (route.textColor) return `#${route.textColor.replace('#', '')}`
  return '#FFFFFF'
}

/** Inline-pill background/border styling for compact departure cards. */
export function getDepartureTimeStyle(
  minutes: number | null,
): Record<string, string> {
  if (minutes === null) return {}
  if (minutes <= 5) {
    return { borderColor: '#10b981', backgroundColor: '#ecfdf5', color: '#047857' }
  }
  if (minutes <= 15) {
    return { borderColor: '#f59e0b', backgroundColor: '#fffbeb', color: '#d97706' }
  }
  return {}
}
