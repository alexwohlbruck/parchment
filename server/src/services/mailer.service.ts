import nodemailer from 'nodemailer'
import { smtpConfig, mailFrom } from '../config/mailer.config'
import { clientOrigin } from '../config/origins.config'

const transporter = nodemailer.createTransport(smtpConfig)

// TODO: Use a proper templating engine
const templates = {
  verificationCode: '<h3>Your verification code</h3><h1>{code}</h1>',
  invitation: `<h3>You have been invited to join Parchment Maps!</h3><a href="${clientOrigin}" target="_blank">Click here to start</a>`,
}

type TemplateName = keyof typeof templates

function renderTemplate(templateName: TemplateName, data?: object) {
  const template = templates[templateName]
  return Object.entries(data || {}).reduce(
    (acc, [key, value]) => acc.replace(`{${key}}`, value),
    template,
  )
}

export async function sendMail(options: {
  from: keyof typeof mailFrom
  to: string | string[]
  subject: string
  template: TemplateName
  data?: object // TODO: Make this type safe
}) {
  return await transporter.sendMail({
    from: smtpConfig.auth.user, // TODO: Use options.from
    to: options.to,
    subject: options.subject,
    html: renderTemplate(options.template, options.data),
  })
}
