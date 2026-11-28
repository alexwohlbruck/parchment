import { api } from '@/lib/api'
import type { AuthorizationRequestDetails, TokenScope } from '@/types/access-token.types'

export type AuthorizationQuery = Record<string, string>

export async function describeAuthorization(query: AuthorizationQuery): Promise<AuthorizationRequestDetails> {
  const { data } = await api.get<AuthorizationRequestDetails>('/oauth/authorize/request', {
    params: query,
    silent: true,
  })
  return data
}

/** Returns where to send the browser: back to the app, carrying a code. */
export async function approveAuthorization(query: AuthorizationQuery, scopes: TokenScope[]): Promise<string> {
  const { data } = await api.post<{ redirectTo: string }>('/oauth/authorize', {
    ...query,
    scope: scopes.join(' '),
  })
  return data.redirectTo
}
