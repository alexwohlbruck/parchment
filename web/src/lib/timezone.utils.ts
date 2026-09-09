export interface TimezoneWarning {
  originTimezone: string
  destinationTimezone: string
  offsetDifferenceMinutes: number
  offsetDifferenceText: string
}

function getUtcOffsetMinutes(timezone: string): number {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  }).formatToParts(now)

  const tzPart = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
  // tzPart looks like "GMT", "GMT+5:30", "GMT-8", etc.
  const match = tzPart.match(/GMT([+-])?(\d+)?(?::(\d+))?/)
  if (!match) return 0

  const sign = match[1] === '-' ? -1 : 1
  const hours = parseInt(match[2] ?? '0', 10)
  const minutes = parseInt(match[3] ?? '0', 10)
  return sign * (hours * 60 + minutes)
}

function formatOffsetDifference(diffMinutes: number): string {
  const sign = diffMinutes > 0 ? '+' : '-'
  const abs = Math.abs(diffMinutes)
  const hours = Math.floor(abs / 60)
  const minutes = abs % 60

  if (minutes === 0) {
    return `${sign}${hours} hour${hours !== 1 ? 's' : ''}`
  }
  return `${sign}${hours}:${minutes.toString().padStart(2, '0')} hours`
}

export function getTimezoneWarning(
  originTimezone: string,
  destinationTimezone: string,
): TimezoneWarning | null {
  if (originTimezone === destinationTimezone) return null

  const originOffset = getUtcOffsetMinutes(originTimezone)
  const destOffset = getUtcOffsetMinutes(destinationTimezone)
  const diffMinutes = destOffset - originOffset

  if (diffMinutes === 0) return null

  return {
    originTimezone,
    destinationTimezone,
    offsetDifferenceMinutes: diffMinutes,
    offsetDifferenceText: formatOffsetDifference(diffMinutes),
  }
}
