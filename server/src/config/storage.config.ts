import { resolve } from 'path'

const DRIVERS = ['local', 's3', 'r2'] as const
export type StorageDriver = (typeof DRIVERS)[number]

const driver = (process.env.STORAGE_DRIVER ?? 'local') as StorageDriver

if (!DRIVERS.includes(driver)) {
  throw new Error(`STORAGE_DRIVER must be one of ${DRIVERS.join(', ')}, got '${driver}'`)
}

export const storage = {
  driver,
  localDir: resolve(process.env.STORAGE_LOCAL_DIR ?? 'data/uploads'),
  /** Origin files are served from directly, e.g. an R2 custom domain. Unset proxies through `/files`. */
  publicUrl: process.env.STORAGE_PUBLIC_URL?.replace(/\/+$/, '') || null,
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    bucket: process.env.S3_BUCKET ?? '',
    region: process.env.S3_REGION || 'auto',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  r2: {
    apiToken: process.env.R2_API_TOKEN ?? '',
    /** Optional: the token's only account is used when unset. */
    accountId: process.env.R2_ACCOUNT_ID ?? '',
  },
}

function requireEnv(vars: Record<string, string>) {
  const missing = Object.entries(vars)
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(`STORAGE_DRIVER=${driver} requires ${missing.join(', ')}`)
  }
}

if (driver === 's3') {
  requireEnv({
    S3_ENDPOINT: storage.s3.endpoint,
    S3_BUCKET: storage.s3.bucket,
    S3_ACCESS_KEY_ID: storage.s3.accessKeyId,
    S3_SECRET_ACCESS_KEY: storage.s3.secretAccessKey,
  })
}

if (driver === 'r2') {
  requireEnv({ R2_API_TOKEN: storage.r2.apiToken, S3_BUCKET: storage.s3.bucket })
}
