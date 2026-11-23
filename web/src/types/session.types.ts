export type Session = {
  id: string
  current: boolean
  createdAt: string
  expiresAt: string
  userAgent?: string
  ipv4?: string
}
