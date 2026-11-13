type TFn = (key: string, params: Record<string, unknown>) => string

/** "A", "A, then the F", "A, then the F, then the 7" */
export function lineSequence(lines: string[], t: TFn): string {
  const named = lines.filter(Boolean)
  return named.length ? named.reduce((joined, line) => t('guidance.itinerary.thenLine', { lines: joined, line })) : ''
}
