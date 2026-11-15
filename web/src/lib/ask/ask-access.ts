import type { AskAccess } from '@/types/ask.types'

/** Whether to show Ask at all: hidden where no key exists or the user turned it off, shown with an upsell otherwise. */
export function isAskOffered(access: AskAccess | null | undefined): boolean {
  if (!access) return false
  return access.allowed || (access.reason !== 'not-configured' && access.reason !== 'turned-off')
}
