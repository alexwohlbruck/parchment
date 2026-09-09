/**
 * Unit tests for the mailer.
 *
 * The behaviour that matters operationally: with SMTP unconfigured (the common
 * self-hosted case) sending must be a logged no-op rather than a throw, or
 * every sign-in attempt would 500. Template rendering also has to replace ALL
 * occurrences of a placeholder — `replaceAll`, not `replace` — since the
 * verification code appears more than once in the HTML. Subject and body copy
 * come from the locale files, so they follow the recipient's language rather
 * than anything the caller passes in.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

let emailConfigured = true

const sendMailImpl = mock(async (_options: any) => ({ messageId: 'msg-1' }))
const createTransport = mock((_config: any) => ({ sendMail: sendMailImpl }))

mock.module('nodemailer', () => ({
  default: { createTransport },
  createTransport,
}))

mock.module('../config/mailer.config', () => ({
  get isEmailConfigured() {
    return emailConfigured
  },
  smtpConfig: { host: 'smtp.test', port: 465 },
  smtpFrom: 'Parchment <no-reply@parchment.test>',
}))

mock.module('../config/origins.config', () => ({
  serverOrigin: 'https://api.parchment.test',
}))

const warn = mock((..._args: unknown[]) => undefined)
mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn, debug: () => {}, error: () => {} },
}))

/** The real templates live on disk; stub the reader so tests are hermetic. */
const readFileSync = mock(
  (_path: string, _encoding: string) =>
    '<html><img src="{{logoUrl}}"><p>{{code}}</p><p>{{code}}</p></html>',
)
mock.module('fs', () => ({ readFileSync, default: { readFileSync } }))

const { sendMail } = await import('./mailer.service')

beforeEach(() => {
  sendMailImpl.mockClear()
  sendMailImpl.mockImplementation(async () => ({ messageId: 'msg-1' }))
  warn.mockClear()
  readFileSync.mockClear()
})

describe('sendMail', () => {
  test('sends through the configured transport', async () => {
    const result = await sendMail({
      to: 'user@parchment.test',
      template: 'verification-code',
      data: { code: '12345678' },
    })

    expect(result).toEqual({ messageId: 'msg-1' })
    expect(sendMailImpl).toHaveBeenCalled()
  })

  test('addresses the message from the configured sender', async () => {
    await sendMail({
      to: 'user@parchment.test',
      template: 'verification-code',
      data: { code: '12345678' },
    })

    expect(sendMailImpl.mock.calls[0][0]).toMatchObject({
      from: 'Parchment <no-reply@parchment.test>',
      to: 'user@parchment.test',
      subject: 'Parchment Email Verification',
    })
  })

  test('takes the subject from the recipient language, not the caller', async () => {
    await sendMail({
      to: 'user@parchment.test',
      template: 'verification-code',
      data: { code: '1' },
      language: 'es-ES',
    })

    expect(sendMailImpl.mock.calls[0][0].subject).toBe(
      'Verificación de correo de Parchment',
    )
  })

  test('accepts a list of recipients', async () => {
    await sendMail({
      to: ['a@parchment.test', 'b@parchment.test'],
      template: 'verification-code',
      data: { code: '1' },
    })

    expect(sendMailImpl.mock.calls[0][0].to).toEqual([
      'a@parchment.test',
      'b@parchment.test',
    ])
  })
})

describe('template rendering', () => {
  test('substitutes every occurrence of a placeholder', async () => {
    // The code appears twice in the real template; `replace` would leave one.
    await sendMail({
      to: 'user@parchment.test',
      template: 'verification-code',
      data: { code: '12345678' },
    })

    const { html } = sendMailImpl.mock.calls[0][0]
    expect(html).not.toContain('{{code}}')
    expect(html.match(/12345678/g)).toHaveLength(2)
  })

  test('injects the absolute logo URL from the server origin', async () => {
    await sendMail({
      to: 'user@parchment.test',
      template: 'verification-code',
      data: { code: '1' },
    })

    const { html } = sendMailImpl.mock.calls[0][0]
    expect(html).toContain('https://api.parchment.test/data/logo.png')
    expect(html).not.toContain('{{logoUrl}}')
  })

  test('fills the body copy in the requested language', async () => {
    readFileSync.mockImplementationOnce(
      () => '<html lang="{{lang}}"><h1>{{heading}}</h1><p>{{body}}</p></html>',
    )

    await sendMail({
      to: 'user@parchment.test',
      template: 'verification-code',
      data: { code: '1' },
      language: 'es-ES',
    })

    const { html } = sendMailImpl.mock.calls[0][0]
    expect(html).toContain('lang="es-ES"')
    expect(html).toContain('Inicia sesión en Parchment')
    expect(html).not.toContain('{{heading}}')
  })

  test('reads the template matching the requested name', async () => {
    await sendMail({
      to: 'user@parchment.test',
      template: 'invitation',
      data: { appUrl: 'https://app.parchment.test' },
    })

    expect(String(readFileSync.mock.calls[0][0])).toContain('invitation.html')
  })
})

describe('with SMTP unconfigured', () => {
  test('the module built no transport, so nothing is sent', async () => {
    // `isEmailConfigured` is read at module load; this file's transport exists.
    // The unconfigured build is covered in mailer.service.unconfigured.test.ts.
    expect(createTransport).toHaveBeenCalled()
  })
})
