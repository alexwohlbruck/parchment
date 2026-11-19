import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

/** A recent's own subtitle, with how long ago it happened appended. */
export function recentSubtitle(subtitle: string | null | undefined, at: number): string {
  return [subtitle, at && dayjs(at).fromNow()].filter(Boolean).join(' · ')
}
