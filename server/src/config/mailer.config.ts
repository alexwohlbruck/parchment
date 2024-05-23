export const mailFrom = {
  support: 'Parchment <support@parchment.app>',
  onboarding: 'Parchment <onboarding@parchment.app>',
}

export const smtpConfig = {
  service: 'Gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_EMAIL,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
}
