export type User = {
  id: string
  email: string
  emailVerified: boolean
  firstName?: string
  lastName?: string
  picture?: string
}

export type Passkey = {
  id: string
  name: string
  publicKey: string
  userId: string
  counter: number
  deviceType: string
  backedUp: boolean
  transports: string
  createdAt: string
}
