import { storage as config } from '../../config/storage.config'
import { serverOrigin } from '../../config/origins.config'
import type { BlobStore } from './blob-store.types'
import { createLocalStore } from './local-store'
import { createS3Store } from './s3-store'

/** Key prefixes anyone may read through `/files`. Everything else stays private. */
export const PUBLIC_PREFIXES = ['avatars/']

export const blobStore: BlobStore =
  config.driver === 's3' ? createS3Store(config.s3) : createLocalStore(config.localDir)

function publicBase() {
  return config.publicUrl ?? `${serverOrigin}/files`
}

export function isPublicKey(key: string) {
  return !key.split('/').includes('..') && PUBLIC_PREFIXES.some((prefix) => key.startsWith(prefix))
}

export function publicUrl(key: string) {
  return `${publicBase()}/${key}`
}

/** The storage key behind a URL from `publicUrl`, or null for any other URL. */
export function keyFromUrl(url: string | null | undefined) {
  const prefix = `${publicBase()}/`
  return url?.startsWith(prefix) ? url.slice(prefix.length) : null
}
