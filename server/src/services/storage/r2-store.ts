import type { BlobStore } from './blob-store.types'
import { createS3Store, type S3StoreConfig } from './s3-store'

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'

export interface R2StoreConfig {
  apiToken: string
  accountId: string
  bucket: string
}

async function cloudflare<T>(path: string, apiToken: string): Promise<T> {
  const response = await fetch(`${CLOUDFLARE_API}${path}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  })
  const body = (await response.json()) as {
    success: boolean
    result: T
    errors?: { message: string }[]
  }
  if (!body.success) {
    const reason = body.errors?.map((error) => error.message).join(', ') || response.statusText
    throw new Error(`Cloudflare ${path} failed: ${reason}`)
  }
  return body.result
}

async function tokenId(apiToken: string, accountId: string) {
  try {
    return (await cloudflare<{ id: string }>(`/accounts/${accountId}/tokens/verify`, apiToken)).id
  } catch {
    return (await cloudflare<{ id: string }>('/user/tokens/verify', apiToken)).id
  }
}

/**
 * S3 credentials for an R2 API token: the access key is the token's id and the
 * secret is the SHA-256 of its value, per Cloudflare's R2 authentication docs.
 */
export async function r2S3Config({ apiToken, accountId, bucket }: R2StoreConfig): Promise<S3StoreConfig> {
  const account = accountId || (await cloudflare<{ id: string }[]>('/accounts', apiToken))[0]?.id
  if (!account) throw new Error('R2_API_TOKEN cannot see any Cloudflare account; set R2_ACCOUNT_ID')

  return {
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    bucket,
    region: 'auto',
    accessKeyId: await tokenId(apiToken, account),
    secretAccessKey: new Bun.CryptoHasher('sha256').update(apiToken).digest('hex'),
  }
}

export function createR2Store(config: R2StoreConfig): BlobStore {
  let store: Promise<BlobStore> | null = null
  const resolve = () =>
    (store ??= r2S3Config(config)
      .then(createS3Store)
      .catch((error) => {
        store = null
        throw error
      }))

  return {
    put: async (key, data, contentType) => (await resolve()).put(key, data, contentType),
    get: async (key) => (await resolve()).get(key),
    delete: async (key) => (await resolve()).delete(key),
  }
}
