import { api } from '@/lib/api'
import type { ModeEstimates, ModeEstimatesRequest } from '@server/lib/directions/mode-estimates'

export type { ModeEstimates }

export async function fetchModeEstimates(
  request: Omit<ModeEstimatesRequest, 'language'>,
  signal: AbortSignal,
): Promise<ModeEstimates> {
  const { data } = await api.post<{ estimates: ModeEstimates }>('/directions/estimates', request, { signal, timeout: 20_000 })
  return data.estimates
}
