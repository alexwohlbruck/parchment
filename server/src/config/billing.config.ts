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

export const registrationMode = (process.env.REGISTRATION_MODE ?? 'invite') as
  | 'invite'
  | 'open'

export const isSelfHosted = !billing.enabled
