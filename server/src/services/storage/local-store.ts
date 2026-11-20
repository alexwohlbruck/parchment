import { mkdir, unlink } from 'fs/promises'
import { dirname, resolve, sep } from 'path'
import type { BlobStore } from './blob-store.types'

export function createLocalStore(root: string): BlobStore {
  function pathFor(key: string) {
    const path = resolve(root, key)
    if (!path.startsWith(root + sep)) throw new Error(`Invalid storage key: ${key}`)
    return path
  }

  return {
    // Bun.file infers the content type from the key's extension on read.
    async put(key, data) {
      const path = pathFor(key)
      await mkdir(dirname(path), { recursive: true })
      await Bun.write(path, data)
    },

    async get(key) {
      const file = Bun.file(pathFor(key))
      return (await file.exists()) ? file : null
    },

    async delete(key) {
      await unlink(pathFor(key)).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    },
  }
}
