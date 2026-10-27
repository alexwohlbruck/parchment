export function speechDuration(text: string, rate = 1): number {
  return (text.trim() ? text.trim().split(/\s+/).length : 0) / (2.5 * rate)
}

export function navigationSpeechRate(text: string, baseRate: number, availableSeconds?: number): number {
  const base = Math.min(1.5, Math.max(0.75, Number.isFinite(baseRate) ? baseRate : 1))
  if (availableSeconds === undefined || !Number.isFinite(availableSeconds) || availableSeconds <= 0) return base
  const estimatedSeconds = speechDuration(text)
  const needed = estimatedSeconds / Math.max(1, availableSeconds - 1)
  return Math.round(Math.min(1.5, Math.max(base, needed)) * 100) / 100
}
