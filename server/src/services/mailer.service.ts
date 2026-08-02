import { readFileSync } from 'fs'
import { resolve } from 'path'
import nodemailer from 'nodemailer'
import { smtpConfig, smtpFrom, isEmailConfigured } from '../config/mailer.config'
import { serverOrigin } from '../config/origins.config'
import { logger } from '../lib/logger'
import { translate } from '../lib/i18n/plugin'
import { DEFAULT_LANGUAGE, type Language, type TranslationKey } from '../lib/i18n/i18n.types'

interface TemplateDataMap {
  'verification-code': { code: string }
  'invitation': { appUrl: string }
}

type TemplateName = keyof TemplateDataMap

/**
 * Copy each template needs beyond its own data. The built HTML carries a
 * `{{placeholder}}` per entry; the value is the locale key filled in at send
 * time, so one built template serves every language.
 */
const TEMPLATE_COPY: Record<TemplateName, Record<string, TranslationKey>> = {
  'verification-code': {
    heading: 'email.verificationCode.heading',
    body: 'email.verificationCode.body',
    expiry: 'email.verificationCode.expiry',
    ignore: 'email.verificationCode.ignore',
  },
  invitation: {
    heading: 'email.invitation.heading',
    body: 'email.invitation.body',
    cta: 'email.invitation.cta',
    fallback: 'email.invitation.fallback',
  },
}

const SUBJECT: Record<TemplateName, TranslationKey> = {
  'verification-code': 'email.verificationCode.subject',
  invitation: 'email.invitation.subject',
}

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

function renderTemplate<T extends TemplateName>(
  name: T,
  data: TemplateDataMap[T],
  language: Language,
): string {
  const html = loadTemplate(name)
  const t = translate(language)
  const copy = Object.fromEntries(
    Object.entries(TEMPLATE_COPY[name]).map(([slot, key]) => [slot, t(key)]),
  )
  const allData: Record<string, string> = {
    logoUrl: `${serverOrigin}/data/logo.png`,
    lang: language,
    ...copy,
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

/**
 * Send a templated email. Subject and body copy come from the locale files, so
 * callers pass the recipient's language rather than an English string — see
 * `resolveEmailLanguage` for how that language is chosen.
 */
export async function sendMail<T extends TemplateName>(options: {
  to: string | string[]
  template: T
  data: TemplateDataMap[T]
  language?: Language
}) {
  if (!transporter) {
    logger.warn({ template: options.template, to: options.to }, 'Email not sent: SMTP is not configured')
    return
  }

  const language = options.language ?? DEFAULT_LANGUAGE

  return await transporter.sendMail({
    from: smtpFrom,
    to: options.to,
    subject: translate(language)(SUBJECT[options.template]),
    html: renderTemplate(options.template, options.data, language),
  })
}
