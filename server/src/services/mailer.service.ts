import { readFileSync } from 'fs'
import { resolve } from 'path'
import nodemailer from 'nodemailer'
import { smtpConfig, smtpFrom, isEmailConfigured } from '../config/mailer.config'
import { serverOrigin } from '../config/origins.config'
import { logger } from '../lib/logger'

interface TemplateDataMap {
  'verification-code': { code: string }
  'invitation': { appUrl: string }
}

type TemplateName = keyof TemplateDataMap

const templateCache = new Map<TemplateName, string>()

const templatesDir = resolve(__dirname, '../../emails/output')

function loadTemplate(name: TemplateName): string {
  let html = templateCache.get(name)
  if (!html) {
    html = readFileSync(resolve(templatesDir, `${name}.html`), 'utf-8')
    if (process.env.NODE_ENV === 'production') {
      templateCache.set(name, html)
    }
  }
  return html
}

function renderTemplate<T extends TemplateName>(name: T, data: TemplateDataMap[T]): string {
  const html = loadTemplate(name)
  const allData: Record<string, string> = {
    logoUrl: `${serverOrigin}/data/logo.png`,
    ...data,
  }
  return Object.entries(allData).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, String(value)),
    html,
  )
}

const transporter = isEmailConfigured
  ? nodemailer.createTransport(smtpConfig!)
  : null

export async function sendMail<T extends TemplateName>(options: {
  to: string | string[]
  subject: string
  template: T
  data: TemplateDataMap[T]
}) {
  if (!transporter) {
    logger.warn({ template: options.template, to: options.to }, 'Email not sent: SMTP is not configured')
    return
  }

  return await transporter.sendMail({
    from: smtpFrom,
    to: options.to,
    subject: options.subject,
    html: renderTemplate(options.template, options.data),
  })
}
