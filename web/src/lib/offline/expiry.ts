/** A local calendar day, `YYYY-MM-DD`. */
export const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)

/** An area kept until a day stays through the whole of that day. */
export const isExpired = (keepUntil: string | undefined, now = new Date()) => !!keepUntil && keepUntil < localDay(now)

/** Noon keeps a `YYYY-MM-DD` on its own day whatever the time zone. */
export const dayAsDate = (day: string) => new Date(`${day}T12:00:00`)
