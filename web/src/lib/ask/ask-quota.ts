/** The day an allowance refills, as the server counts months in UTC. */
export function formatResetDay(resetsAt: string, locale: string): string {
  return new Date(resetsAt).toLocaleDateString(locale, {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
