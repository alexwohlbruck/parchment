import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

const sendEmailVerificationCode = mock(async () => true)
mock.module('./auth.service', () => ({ rpID: 'localhost', sendEmailVerificationCode }))

const createServerToken = mock(async () => '12345678')
const validateServerToken = mock(async (code: string) =>
  code === '12345678' ? 'valid' : 'invalid',
)
mock.module('./token.service', () => ({ createServerToken, validateServerToken }))

const verifyAuthenticationResponse = mock(async () => ({
  verified: true,
  authenticationInfo: { newCounter: 2 },
}))
mock.module('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: async (o: { allowCredentials: unknown[] }) => ({
    challenge: 'c',
    allowCredentials: o.allowCredentials,
  }),
  verifyAuthenticationResponse,
}))

const { beginStepUp, verifyStepUp } = await import('./step-up.service')

const passkey = { id: 'pk-1', transports: 'internal' }
const assertion = { id: 'pk-1' } as never

beforeEach(() => {
  dbMock.reset()
  sendEmailVerificationCode.mockClear()
  verifyAuthenticationResponse.mockClear()
})

describe('beginStepUp', () => {
  test('offers only the user’s own passkeys', async () => {
    dbMock.queueSelect([passkey])
    const challenge = await beginStepUp('u1')
    expect(challenge.method).toBe('passkey')
    expect(sendEmailVerificationCode).not.toHaveBeenCalled()
  })

  test('emails a code when the user has no passkey', async () => {
    dbMock.queueSelect([])
    dbMock.queueSelect([{ email: 'a@b.test' }])
    expect(await beginStepUp('u1')).toEqual({ method: 'email' })
    expect(sendEmailVerificationCode).toHaveBeenCalled()
  })
})

describe('verifyStepUp', () => {
  test('accepts the emailed code', async () => {
    expect(await verifyStepUp('u1', { code: '12345678' }, undefined)).toBe(true)
    expect(await verifyStepUp('u1', { code: '00000000' }, undefined)).toBe(false)
  })

  test('refuses a passkey without the challenge it answered', async () => {
    expect(await verifyStepUp('u1', { passkey: assertion }, undefined)).toBe(false)
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
  })

  test('refuses a passkey the user does not own', async () => {
    dbMock.queueSelect([])
    expect(await verifyStepUp('u1', { passkey: assertion }, 'c')).toBe(false)
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
  })

  test('accepts the user’s own verified passkey', async () => {
    dbMock.queueSelect([{ ...passkey, publicKey: '', counter: 1 }])
    expect(await verifyStepUp('u1', { passkey: assertion }, 'c')).toBe(true)
  })

  test('refuses with no proof', async () => {
    expect(await verifyStepUp('u1', {}, 'c')).toBe(false)
  })
})
