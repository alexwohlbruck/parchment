import { resolve } from 'path'

export type StorageDriver = 'local' | 's3'

const driver = (process.env.STORAGE_DRIVER ?? 'local') as StorageDriver

if (driver !== 'local' && driver !== 's3') {
  throw new Error(`STORAGE_DRIVER must be 'local' or 's3', got '${driver}'`)
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
}

if (driver === 's3') {
  const missing = Object.entries({
    S3_ENDPOINT: storage.s3.endpoint,
    S3_BUCKET: storage.s3.bucket,
    S3_ACCESS_KEY_ID: storage.s3.accessKeyId,
    S3_SECRET_ACCESS_KEY: storage.s3.secretAccessKey,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(`STORAGE_DRIVER=s3 requires ${missing.join(', ')}`)
  }
}
