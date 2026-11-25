export const SHARE_DURATIONS = ['1h', '4h', 'tomorrow', 'indefinite'] as const
export type ShareDuration = (typeof SHARE_DURATIONS)[number]

export interface LocationShareState {
  enabled: boolean
  expiresAt: Date | null
}

const HOUR_MS = 60 * 60_000
// Before this hour, "tomorrow" still means the morning about to come.
const NIGHT_ENDS_HOUR = 4
const TOMORROW_ENDS_HOUR = 9

/** When a share picked now should end, in the sharer's local time; null shares until turned off. */
export function shareExpiry(duration: ShareDuration, now = new Date()): Date | null {
  switch (duration) {
    case '1h':
      return new Date(now.getTime() + HOUR_MS)
    case '4h':
      return new Date(now.getTime() + 4 * HOUR_MS)
    case 'tomorrow': {
      const end = new Date(now)
      if (now.getHours() >= NIGHT_ENDS_HOUR) end.setDate(end.getDate() + 1)
      end.setHours(TOMORROW_ENDS_HOUR, 0, 0, 0)
      return end
    }
    case 'indefinite':
      return null
  }
}

export type ShareTimeLeft =
  | { unit: 'minute'; value: number }
  | { unit: 'hour'; value: number }

/** What's left of a share, rounded the way someone would say it aloud. */
export function shareTimeLeft(expiresAt: Date, now = new Date()): ShareTimeLeft | null {
  const ms = expiresAt.getTime() - now.getTime()
  if (ms <= 0) return null
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return { unit: 'minute', value: minutes }
  return { unit: 'hour', value: Math.round(minutes / 60) }
}

type TFn = (key: string, named?: Record<string, unknown>) => string

/** "2 hr left" for a timed share; null for one that runs until turned off or has ended. */
export function formatShareTimeLeft(
  expiresAt: Date | null,
  t: TFn,
  now = new Date(),
): string | null {
  const left = expiresAt && shareTimeLeft(expiresAt, now)
  if (!left) return null
  return left.unit === 'minute'
    ? t('friends.sharing.minutesLeft', { n: left.value })
    : t('friends.sharing.hoursLeft', { n: left.value })
}

function isNextDay(date: Date, today: Date): boolean {
  const next = new Date(today)
  next.setDate(next.getDate() + 1)
  return date.toDateString() === next.toDateString()
}

/** "Until 4:20 PM · 1 hr left", "Until tomorrow, 9:00 AM · 18 hr left", or "Until you turn it off". */
export function formatShareStatus(
  expiresAt: Date | null,
  t: TFn,
  formatTime: (date: Date) => string,
  now = new Date(),
): string {
  if (!expiresAt) return t('friends.sharing.untilTurnedOff')
  const time = formatTime(expiresAt)
  const until = isNextDay(expiresAt, now)
    ? t('friends.sharing.untilTomorrow', { time })
    : t('friends.sharing.until', { time })
  const left = formatShareTimeLeft(expiresAt, t, now)
  return left ? `${until} · ${left}` : until
}
