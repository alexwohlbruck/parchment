export const billing = {
  enabled: !!process.env.POLAR_ACCESS_TOKEN,
  accessToken: process.env.POLAR_ACCESS_TOKEN ?? '',
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? '',
  organizationId: process.env.POLAR_ORGANIZATION_ID ?? '',
  premiumProductId: process.env.POLAR_PREMIUM_PRODUCT_ID ?? '',
}

export const registrationMode = (process.env.REGISTRATION_MODE ?? 'invite') as
  | 'invite'
  | 'open'

export const isSelfHosted = !billing.enabled
