export const TOKEN_SCOPES = [
  'places:read',
  'trips:read',
  'weather:read',
  'library:read',
  'library:write',
] as const

export type TokenScope = (typeof TOKEN_SCOPES)[number]

export const ACCESS_TOKEN_KINDS = ['personal', 'oauth'] as const

export type AccessTokenKind = (typeof ACCESS_TOKEN_KINDS)[number]

/** Days a new personal token can last, besides never expiring. */
export const PERSONAL_TOKEN_DAYS = [30, 90, 365] as const

export type PersonalTokenLifetime = (typeof PERSONAL_TOKEN_DAYS)[number] | null

export interface AccessTokenSummary {
  id: string
  kind: AccessTokenKind
  name: string
  scopes: TokenScope[]
  /** The secret's first characters, enough to tell tokens apart. */
  hint: string
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date | null
}

export interface CreatedAccessToken extends AccessTokenSummary {
  /** Shown once; only its hash is stored. */
  secret: string
}

/** Who a scoped token acts for, and what it may reach. */
export interface TokenGrant {
  tokenId: string
  userId: string
  scopes: TokenScope[]
  expiresAt: Date | null
}
