const host = process.env.SMTP_HOST
const port = Number(process.env.SMTP_PORT || 465)
const secure = process.env.SMTP_SECURE !== 'false'
const user = process.env.SMTP_USER
const pass = process.env.SMTP_PASS

export const isEmailConfigured = Boolean(host)

export const smtpFrom = process.env.SMTP_FROM || 'Parchment <noreply@parchment.app>'

export const smtpConfig = isEmailConfigured
  ? {
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  }
  : null
