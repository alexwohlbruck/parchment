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
      const response = await fetch(client.presign(key))
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`S3 GET ${key} failed with ${response.status}`)
      return response.blob()
    },

    async delete(key) {
      await client.delete(key)
    },
  }
}
