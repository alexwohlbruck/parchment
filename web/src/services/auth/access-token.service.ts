import { api } from '@/lib/api'
import type {
  AccessTokenSummary,
  CreatedAccessToken,
  PersonalTokenLifetime,
  TokenScope,
} from '@/types/access-token.types'

export async function listAccessTokens(): Promise<AccessTokenSummary[]> {
  const { data } = await api.get<AccessTokenSummary[]>('/auth/tokens')
  return data
}

export async function createAccessToken(input: {
  name: string
  scopes: TokenScope[]
  expiresInDays: PersonalTokenLifetime
}): Promise<CreatedAccessToken> {
  const { data } = await api.post<CreatedAccessToken>('/auth/tokens', input)
  return data
}

export async function revokeAccessToken(id: string): Promise<void> {
  await api.delete(`/auth/tokens/${encodeURIComponent(id)}`)
}
