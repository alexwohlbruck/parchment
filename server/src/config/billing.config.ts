import { verifyLicense, type LicensePayload } from '../lib/license'
import { logger } from '../lib/logger'

let licensePayload: LicensePayload | null = null

const licenseToken = process.env.PARCHMENT_LICENSE ?? ''
if (licenseToken) {
  licensePayload = await verifyLicense(licenseToken)
  if (licensePayload) {
    logger.info('Valid license detected — billing features available')
  } else {
    logger.warn('PARCHMENT_LICENSE is set but invalid or expired — billing disabled')
  }
}

const isDev = process.env.NODE_ENV === 'development'
const hasPolarConfig = !!process.env.POLAR_ACCESS_TOKEN
const hasValidLicense = isDev || !!licensePayload?.features?.includes('billing')

export const billing = {
  enabled: hasPolarConfig && hasValidLicense,
  sandbox: process.env.POLAR_SANDBOX === 'true',
  accessToken: process.env.POLAR_ACCESS_TOKEN ?? '',
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET ?? '',
  organizationId: process.env.POLAR_ORGANIZATION_ID ?? '',
  premiumProductId: process.env.POLAR_PREMIUM_PRODUCT_ID ?? '',
}

if (billing.enabled && !billing.webhookSecret) {
  throw new Error(
    'POLAR_WEBHOOK_SECRET must be set when billing is enabled. ' +
    'Set the webhook signing secret from your Polar dashboard.',
  )
}

export const registrationMode = (process.env.REGISTRATION_MODE ?? 'invite') as
  | 'invite'
  | 'open'

export const isSelfHosted =
  process.env.PARCHMENT_SELF_HOSTED === 'true' && !billing.enabled

if (isSelfHosted) {
  logger.info('Running in self-hosted mode — all users receive full permissions')
} else if (!billing.enabled) {
  logger.warn(
    'Billing is not configured and PARCHMENT_SELF_HOSTED is not set — premium features will be unavailable',
  )
}
