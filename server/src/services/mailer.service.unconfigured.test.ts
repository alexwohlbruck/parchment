/**
 * Unit tests for the mailer with SMTP unconfigured — the default self-hosted
 * state.
 *
 * The transporter is built once at module load from `isEmailConfigured`, so
 * this shape needs its own file (and, with per-file isolation, its own
 * process). Sending must degrade to a logged no-op: throwing here would turn
 * every sign-in request into a 500 on an instance that simply hasn't set up
 * email yet.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

const sendMailImpl = mock(async (_options: any) => ({ messageId: 'msg-1' }))
const createTransport = mock((_config: any) => ({ sendMail: sendMailImpl }))

mock.module('nodemailer', () => ({
  default: { createTransport },
  createTransport,
}))

mock.module('../config/mailer.config', () => ({
  isEmailConfigured: false,
  smtpConfig: null,
  smtpFrom: undefined,
}))

mock.module('../config/origins.config', () => ({
  serverOrigin: 'https://api.parchment.test',
}))

const warn = mock((..._args: unknown[]) => undefined)
mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn, debug: () => {}, error: () => {} },
}))

const readFileSync = mock(() => '<html>{{code}}</html>')
mock.module('fs', () => ({ readFileSync, default: { readFileSync } }))

const { sendMail } = await import('./mailer.service')

beforeEach(() => {
  sendMailImpl.mockClear()
  warn.mockClear()
  readFileSync.mockClear()
})

describe('sendMail with SMTP unconfigured', () => {
  test('never builds a transport', () => {
    expect(createTransport).not.toHaveBeenCalled()
  })

  test('resolves without throwing', async () => {
    await expect(
      sendMail({
        to: 'user@parchment.test',
        subject: 'Your code',
        template: 'verification-code',
        data: { code: '12345678' },
      }),
    ).resolves.toBeUndefined()
  })

  test('sends nothing', async () => {
    await sendMail({
      to: 'user@parchment.test',
      subject: 'Your code',
      template: 'verification-code',
      data: { code: '12345678' },
    })

    expect(sendMailImpl).not.toHaveBeenCalled()
  })

  test('logs a warning naming the template and recipient', async () => {
    await sendMail({
      to: 'user@parchment.test',
      subject: 'Your code',
      template: 'verification-code',
      data: { code: '12345678' },
    })

    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls[0][0]).toMatchObject({
      template: 'verification-code',
      to: 'user@parchment.test',
    })
  })

  test('does not even render the template', async () => {
    await sendMail({
      to: 'user@parchment.test',
      subject: 'Your code',
      template: 'verification-code',
      data: { code: '12345678' },
    })

    expect(readFileSync).not.toHaveBeenCalled()
  })

  test('never logs the verification code itself', async () => {
    await sendMail({
      to: 'user@parchment.test',
      subject: 'Your code',
      template: 'verification-code',
      data: { code: '12345678' },
    })

    expect(JSON.stringify(warn.mock.calls)).not.toContain('12345678')
  })
})
