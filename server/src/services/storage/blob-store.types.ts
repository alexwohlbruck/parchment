export interface BlobStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>
  /** The stored blob, or null when nothing is stored under `key`. */
  get(key: string): Promise<Blob | null>
  delete(key: string): Promise<void>
}
