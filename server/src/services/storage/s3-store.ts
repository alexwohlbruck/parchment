import { S3Client } from 'bun'
import type { BlobStore } from './blob-store.types'

export interface S3StoreConfig {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

/** Any S3-compatible bucket: Cloudflare R2, AWS S3, MinIO, Garage, Backblaze B2. */
export function createS3Store(config: S3StoreConfig): BlobStore {
  const client = new S3Client(config)

  return {
    async put(key, data, contentType) {
      await client.write(key, data, { type: contentType })
    },

    async get(key) {
      const file = client.file(key)
      return (await file.exists()) ? file : null
    },

    async delete(key) {
      await client.delete(key)
    },
  }
}
