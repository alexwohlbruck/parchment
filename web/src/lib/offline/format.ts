const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const

export function formatBytes(bytes: number, locale?: string): string {
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 && unit > 1 ? 1 : 0,
  }).format(value)
}
